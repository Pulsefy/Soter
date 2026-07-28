import * as path from 'path';
import * as crypto from 'crypto';
import { ChunkStorageService } from '../resumable-upload/chunk-storage.service';
import * as fs from 'fs/promises';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  createReadStream: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
  readFile: jest.fn(),
  stat: jest.fn(),
  access: jest.fn(),
  unlink: jest.fn(),
  rm: jest.fn(),
  rmdir: jest.fn(),
  readdir: jest.fn(),
}));

describe('ChunkStorageService', () => {
  let service: ChunkStorageService;
  const sessionId = 'test-session-1234';
  const chunkData = Buffer.from('hello chunk data 0123456789');

  beforeEach(() => {
    jest.clearAllMocks();
    (require('fs').existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('uploads') && p.endsWith('chunks')) return true;
      return false;
    });
    (require('fs/promises').readdir as jest.Mock).mockResolvedValue([]);
    service = new ChunkStorageService();
  });

  describe('onModuleInit', () => {
    it('creates the chunk root directory if missing', () => {
      (require('fs').existsSync as jest.Mock).mockReturnValue(false);
      service.onModuleInit();
      expect(require('fs').mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join('uploads', 'chunks')),
        { recursive: true },
      );
    });
  });

  describe('storeChunk / readChunk', () => {
    it('writes chunk to disk path and reads it back', async () => {
      (require('fs/promises').writeFile as jest.Mock).mockResolvedValue(
        undefined,
      );
      (require('fs/promises').readFile as jest.Mock).mockResolvedValue(
        chunkData,
      );
      const writtenPath = await service.storeChunk(sessionId, 0, chunkData);
      expect(writtenPath).toContain(sessionId.slice(0, 2));
      expect(writtenPath).toContain('chunk-0.bin');
      expect(require('fs/promises').writeFile).toHaveBeenCalledWith(
        writtenPath,
        chunkData,
      );
      const readBack = await service.readChunk(sessionId, 0);
      expect(readBack).toEqual(chunkData);
    });

    it('returns null when reading a missing chunk (ENOENT)', async () => {
      const err: NodeJS.ErrnoException = new Error('no such file');
      err.code = 'ENOENT';
      (require('fs/promises').readFile as jest.Mock).mockRejectedValue(err);
      expect(await service.readChunk(sessionId, 99)).toBeNull();
    });
  });

  describe('verifyChunkOnDisk', () => {
    const correctChecksum = crypto
      .createHash('sha256')
      .update(chunkData)
      .digest('hex');

    it('reports ok when size and checksum match', async () => {
      (require('fs/promises').stat as jest.Mock).mockResolvedValue({
        size: chunkData.length,
      });
      (require('fs/promises').readFile as jest.Mock).mockResolvedValue(
        chunkData,
      );
      const result = await service.verifyChunkOnDisk(
        sessionId,
        0,
        correctChecksum,
        chunkData.length,
      );
      expect(result.ok).toBe(true);
      expect(result.actualChecksum).toBe(correctChecksum);
      expect(result.actualSize).toBe(chunkData.length);
    });

    it('reports not ok on size mismatch (file larger than expected)', async () => {
      (require('fs/promises').stat as jest.Mock).mockResolvedValue({
        size: chunkData.length + 7,
      });
      const result = await service.verifyChunkOnDisk(
        sessionId,
        0,
        correctChecksum,
        chunkData.length,
      );
      expect(result.ok).toBe(false);
      expect(result.actualSize).toBe(chunkData.length + 7);
      expect(result.actualChecksum).toBeNull();
    });

    it('reports not ok on checksum mismatch', async () => {
      (require('fs/promises').stat as jest.Mock).mockResolvedValue({
        size: chunkData.length,
      });
      (require('fs/promises').readFile as jest.Mock).mockResolvedValue(
        Buffer.from('corrupted data same length yes'),
      );
      const result = await service.verifyChunkOnDisk(
        sessionId,
        0,
        correctChecksum,
        chunkData.length,
      );
      expect(result.ok).toBe(false);
      expect(result.actualChecksum).not.toBe(correctChecksum);
    });

    it('reports not ok for missing file without re-throwing', async () => {
      const err: NodeJS.ErrnoException = new Error('no such');
      err.code = 'ENOENT';
      (require('fs/promises').stat as jest.Mock).mockRejectedValue(err);
      const result = await service.verifyChunkOnDisk(
        sessionId,
        0,
        correctChecksum,
        chunkData.length,
      );
      expect(result.ok).toBe(false);
      expect(result.actualSize).toBe(0);
    });
  });

  describe('assembleAllChunks', () => {
    it('concatenates chunks in index order and returns checksums/sizes', async () => {
      const a = Buffer.from('aaaa');
      const b = Buffer.from('bbbb');
      (require('fs/promises').readFile as jest.Mock)
        .mockResolvedValueOnce(a)
        .mockResolvedValueOnce(b);
      const result = await service.assembleAllChunks(sessionId, 2);
      expect(result.buffer).toEqual(Buffer.concat([a, b]));
      expect(result.sizes).toEqual([4, 4]);
      expect(result.checksums).toHaveLength(2);
    });

    it('throws when any chunk is missing', async () => {
      const err: NodeJS.ErrnoException = new Error('no such');
      err.code = 'ENOENT';
      (require('fs/promises').readFile as jest.Mock).mockRejectedValue(err);
      await expect(service.assembleAllChunks(sessionId, 2)).rejects.toThrow(
        /missing from disk storage/,
      );
    });
  });

  describe('cleanupSession', () => {
    it('removes the session directory recursively', async () => {
      (require('fs/promises').rm as jest.Mock).mockResolvedValue(undefined);
      await service.cleanupSession(sessionId);
      expect(require('fs/promises').rm).toHaveBeenCalledWith(
        expect.stringContaining(sessionId),
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it('does not throw on ENOENT during cleanup', async () => {
      const err: NodeJS.ErrnoException = new Error('no such');
      err.code = 'ENOENT';
      (require('fs/promises').rm as jest.Mock).mockRejectedValue(err);
      await expect(service.cleanupSession(sessionId)).resolves.not.toThrow();
    });
  });
});
