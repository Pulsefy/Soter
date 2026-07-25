import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fsPromises from 'fs/promises';
import { UploadSessionService } from '../evidence/upload-session.service';
import { UploadSessionStatus } from '@prisma/client';

// ── helpers ──────────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeSession(overrides: Partial<ReturnType<typeof baseSession>> = {}) {
  return { ...baseSession(), ...overrides };
}

function baseSession() {
  return {
    id: 'sess-1',
    ownerId: 'owner-1',
    orgId: null,
    fileName: 'evidence.txt',
    mimeType: 'text/plain',
    totalSize: 300,
    chunkSize: 100,
    totalChunks: 3,
    status: UploadSessionStatus.active,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── mocks ────────────────────────────────────────────────────────────────────

const mockStore = {
  getSession: jest.fn(),
  createSession: jest.fn(),
  updateSessionStatus: jest.fn(),
  storeChunk: jest.fn(),
  getChunk: jest.fn(),
  getExistingChunkChecksum: jest.fn(),
  addReceivedChunk: jest.fn(),
  isChunkReceived: jest.fn(),
  getReceivedChunks: jest.fn(),
  getAllChunks: jest.fn(),
  cleanupSession: jest.fn(),
};

const mockPrisma = {
  evidenceQueueItem: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

const mockEncryption = {
  encryptBuffer: jest.fn((buf: Buffer) => buf),
};

const mockAudit = {
  record: jest.fn(),
};

jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
}));

// ── suite ─────────────────────────────────────────────────────────────────────

describe('UploadSessionService', () => {
  let service: UploadSessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadSessionService(
      mockPrisma as any,
      mockEncryption as any,
      mockAudit as any,
      mockStore as any,
    );
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a session via the store and returns it', async () => {
      const dto = {
        fileName: 'doc.txt',
        mimeType: 'text/plain',
        totalSize: 200,
        chunkSize: 100,
      };
      const created = makeSession({ totalChunks: 2 });
      mockStore.createSession.mockResolvedValue(created);

      const result = await service.create(dto, 'owner-1');

      expect(mockStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ totalChunks: 2 }),
        expect.any(Number),
      );
      expect(result).toBe(created);
    });

    it('rejects an unsafe fileName', async () => {
      await expect(
        service.create(
          {
            fileName: '../../evil.txt',
            mimeType: 'text/plain',
            totalSize: 10,
            chunkSize: 10,
          },
          'owner-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a disallowed mimeType', async () => {
      await expect(
        service.create(
          {
            fileName: 'file.exe',
            mimeType: 'application/x-msdownload',
            totalSize: 10,
            chunkSize: 10,
          },
          'owner-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects totalSize exceeding MAX_FILE_SIZE', async () => {
      await expect(
        service.create(
          {
            fileName: 'big.txt',
            mimeType: 'text/plain',
            totalSize: 11 * 1024 * 1024,
            chunkSize: 1024 * 1024,
          },
          'owner-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── uploadChunk ─────────────────────────────────────────────────────────────

  describe('uploadChunk', () => {
    const chunk = Buffer.alloc(100, 0x61);
    const checksum = sha256(chunk);

    beforeEach(() => {
      mockStore.getSession.mockResolvedValue(makeSession());
      mockStore.getExistingChunkChecksum.mockResolvedValue(null);
      mockStore.storeChunk.mockResolvedValue(undefined);
      mockStore.addReceivedChunk.mockResolvedValue(undefined);
    });

    it('accepts a valid chunk', async () => {
      const result = await service.uploadChunk(
        'sess-1',
        0,
        checksum,
        chunk,
        'owner-1',
      );
      expect(result).toMatchObject({
        sessionId: 'sess-1',
        index: 0,
        received: true,
        duplicate: false,
      });
      expect(mockStore.storeChunk).toHaveBeenCalledWith(
        'sess-1',
        0,
        chunk,
        expect.any(Number),
      );
    });

    it('returns duplicate:true for an already-received chunk with matching checksum', async () => {
      mockStore.getExistingChunkChecksum.mockResolvedValue(checksum);

      const result = await service.uploadChunk(
        'sess-1',
        0,
        checksum,
        chunk,
        'owner-1',
      );
      expect(result).toMatchObject({ duplicate: true });
      expect(mockStore.storeChunk).not.toHaveBeenCalled();
    });

    it('throws ConflictException for duplicate chunk with different checksum', async () => {
      mockStore.getExistingChunkChecksum.mockResolvedValue('different');

      await expect(
        service.uploadChunk('sess-1', 0, checksum, chunk, 'owner-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException for out-of-range index', async () => {
      await expect(
        service.uploadChunk('sess-1', 99, checksum, chunk, 'owner-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for checksum mismatch', async () => {
      await expect(
        service.uploadChunk('sess-1', 0, 'badhash', chunk, 'owner-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for wrong chunk size', async () => {
      const wrongSize = Buffer.alloc(50, 0x61);
      const ws = sha256(wrongSize);
      await expect(
        service.uploadChunk('sess-1', 0, ws, wrongSize, 'owner-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when ownerId does not match', async () => {
      await expect(
        service.uploadChunk('sess-1', 0, checksum, chunk, 'other-owner'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown session', async () => {
      mockStore.getSession.mockResolvedValue(null);
      await expect(
        service.uploadChunk('sess-1', 0, checksum, chunk, 'owner-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for expired session', async () => {
      mockStore.getSession.mockResolvedValue(
        makeSession({ expiresAt: new Date(Date.now() - 1000) }),
      );
      mockStore.updateSessionStatus.mockResolvedValue(undefined);
      await expect(
        service.uploadChunk('sess-1', 0, checksum, chunk, 'owner-1'),
      ).rejects.toThrow(/expired/i);
    });
  });

  // ── finalize ─────────────────────────────────────────────────────────────────

  describe('finalize', () => {
    const chunkBuf = Buffer.alloc(100, 0x61);

    beforeEach(() => {
      mockStore.getSession.mockResolvedValue(makeSession());
      mockStore.getReceivedChunks.mockResolvedValue([0, 1, 2]);
      mockStore.getAllChunks.mockResolvedValue([chunkBuf, chunkBuf, chunkBuf]);
      mockStore.updateSessionStatus.mockResolvedValue(undefined);
      mockStore.cleanupSession.mockResolvedValue(undefined);
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValue(null);
      mockPrisma.evidenceQueueItem.create.mockResolvedValue({
        id: 'ev-1',
        fileName: 'evidence.txt',
      });
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);
    });

    it('assembles chunks from Redis and creates an evidence queue item', async () => {
      const result = await service.finalize('sess-1', 'owner-1');
      expect(result).toMatchObject({ id: 'ev-1' });
      expect(mockPrisma.evidenceQueueItem.create).toHaveBeenCalled();
      expect(mockStore.updateSessionStatus).toHaveBeenCalledWith(
        'sess-1',
        UploadSessionStatus.completed,
      );
    });

    it('throws BadRequestException when chunks are missing', async () => {
      mockStore.getReceivedChunks.mockResolvedValue([0]); // only 1 of 3
      await expect(service.finalize('sess-1', 'owner-1')).rejects.toThrow(
        /Missing chunks/i,
      );
    });

    it('throws ConflictException when assembled file is a duplicate', async () => {
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValue({
        id: 'existing',
      });
      (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);
      await expect(service.finalize('sess-1', 'owner-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('cleans up Redis keys after finalization', async () => {
      await service.finalize('sess-1', 'owner-1');
      expect(mockStore.cleanupSession).toHaveBeenCalledWith('sess-1', 3);
    });
  });

  // ── getStatus (resume) ────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns received chunk indices for resume', async () => {
      mockStore.getSession.mockResolvedValue(makeSession());
      mockStore.getReceivedChunks.mockResolvedValue([0, 1]);

      const status = await service.getStatus('sess-1', 'owner-1');
      expect(status).toEqual({
        sessionId: 'sess-1',
        totalChunks: 3,
        receivedChunks: [0, 1],
      });
    });

    it('returns empty array when no chunks received yet', async () => {
      mockStore.getSession.mockResolvedValue(makeSession());
      mockStore.getReceivedChunks.mockResolvedValue([]);

      const status = await service.getStatus('sess-1', 'owner-1');
      expect(status.receivedChunks).toEqual([]);
    });
  });
});
