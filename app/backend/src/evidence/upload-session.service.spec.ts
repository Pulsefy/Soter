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

const mockPrisma = {
  uploadSession: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  uploadChunk: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  evidenceQueueItem: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

const mockEncryption = {
  encryptBuffer: jest.fn((buf: Buffer) => buf), // identity for tests
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
    );
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a session and returns it', async () => {
      const dto = {
        fileName: 'doc.txt',
        mimeType: 'text/plain',
        totalSize: 200,
        chunkSize: 100,
      };
      const created = makeSession({ totalChunks: 2 });
      mockPrisma.uploadSession.create.mockResolvedValue(created);

      const result = await service.create(dto, 'owner-1');

      expect(mockPrisma.uploadSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalChunks: 2 }),
        }),
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
      mockPrisma.uploadSession.findUnique.mockResolvedValue(makeSession());
      mockPrisma.uploadChunk.findUnique.mockResolvedValue(null);
      mockPrisma.uploadChunk.create.mockResolvedValue({});
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
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
      expect(fsPromises.writeFile).toHaveBeenCalled();
    });

    it('returns duplicate:true for an already-received chunk with matching checksum', async () => {
      mockPrisma.uploadChunk.findUnique.mockResolvedValue({
        index: 0,
        checksum,
      });

      const result = await service.uploadChunk(
        'sess-1',
        0,
        checksum,
        chunk,
        'owner-1',
      );
      expect(result).toMatchObject({ duplicate: true });
      expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it('throws ConflictException for duplicate chunk with different checksum', async () => {
      mockPrisma.uploadChunk.findUnique.mockResolvedValue({
        index: 0,
        checksum: 'different',
      });

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
      mockPrisma.uploadSession.findUnique.mockResolvedValue(null);
      await expect(
        service.uploadChunk('sess-1', 0, checksum, chunk, 'owner-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for expired session', async () => {
      mockPrisma.uploadSession.findUnique.mockResolvedValue(
        makeSession({ expiresAt: new Date(Date.now() - 1000) }),
      );
      mockPrisma.uploadSession.update.mockResolvedValue({});
      await expect(
        service.uploadChunk('sess-1', 0, checksum, chunk, 'owner-1'),
      ).rejects.toThrow(/expired/i);
    });
  });

  // ── finalize ─────────────────────────────────────────────────────────────────

  describe('finalize', () => {
    const chunkBuf = Buffer.alloc(100, 0x61);

    const chunks = [0, 1, 2].map(i => ({
      index: i,
      size: 100,
      checksum: sha256(chunkBuf),
      filePath: `/tmp/sess-1-${i}`,
    }));

    beforeEach(() => {
      mockPrisma.uploadSession.findUnique.mockResolvedValue(makeSession());
      mockPrisma.uploadChunk.findMany.mockResolvedValue(chunks);
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValue(null);
      mockPrisma.evidenceQueueItem.create.mockResolvedValue({
        id: 'ev-1',
        fileName: 'evidence.txt',
      });
      mockPrisma.uploadSession.update.mockResolvedValue({});
      (fsPromises.readFile as jest.Mock).mockResolvedValue(chunkBuf);
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);
    });

    it('assembles chunks and creates an evidence queue item', async () => {
      const result = await service.finalize('sess-1', 'owner-1');
      expect(result).toMatchObject({ id: 'ev-1' });
      expect(mockPrisma.evidenceQueueItem.create).toHaveBeenCalled();
      expect(mockPrisma.uploadSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: UploadSessionStatus.completed },
        }),
      );
    });

    it('throws BadRequestException when chunks are missing', async () => {
      mockPrisma.uploadChunk.findMany.mockResolvedValue([chunks[0]]); // only 1 of 3
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

    it('cleans up chunk files after finalization', async () => {
      await service.finalize('sess-1', 'owner-1');
      expect(fsPromises.unlink).toHaveBeenCalledTimes(chunks.length);
    });
  });

  // ── getStatus (resume) ────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns received chunk indices for resume', async () => {
      mockPrisma.uploadSession.findUnique.mockResolvedValue(makeSession());
      mockPrisma.uploadChunk.findMany.mockResolvedValue([
        { index: 0 },
        { index: 1 },
      ]);

      const status = await service.getStatus('sess-1', 'owner-1');
      expect(status).toEqual({
        sessionId: 'sess-1',
        totalChunks: 3,
        receivedChunks: [0, 1],
      });
    });

    it('returns empty array when no chunks received yet', async () => {
      mockPrisma.uploadSession.findUnique.mockResolvedValue(makeSession());
      mockPrisma.uploadChunk.findMany.mockResolvedValue([]);

      const status = await service.getStatus('sess-1', 'owner-1');
      expect(status.receivedChunks).toEqual([]);
    });
  });
});
