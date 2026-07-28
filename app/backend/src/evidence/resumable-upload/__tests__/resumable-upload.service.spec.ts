import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fsPromises from 'fs/promises';
import { ResumableUploadService } from '../resumable-upload/resumable-upload.service';
import { UploadSessionStatus } from '@prisma/client';

const sha256 = (buf: Buffer): string =>
  crypto.createHash('sha256').update(buf).digest('hex');

function makeChunk(size: number, fillByte: number): Buffer {
  return Buffer.alloc(size, fillByte);
}

function baseSession(overrides: Record<string, any> = {}) {
  const totalSize = 1500;
  const chunkSize = 500;
  const totalChunks = 3;
  return {
    id: 'upl-1',
    ownerId: 'owner-1',
    orgId: null,
    fileName: 'evidence.pdf',
    mimeType: 'application/pdf',
    totalSize,
    chunkSize,
    totalChunks,
    uploadedBytes: 0,
    fileChecksum: null,
    status: UploadSessionStatus.pending,
    retryCount: 0,
    maxAttempts: 5,
    lastError: null,
    lastAttemptAt: null,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    failedAt: null,
    chunks: [],
    ...overrides,
  } as any;
}

const mockRepo = {
  createSession: jest.fn(),
  findSessionById: jest.fn(),
  findSessionByOwner: jest.fn(),
  findIncompleteSessionsByOwner: jest.fn(),
  findAllIncompleteSessions: jest.fn(),
  findSessionsByOwner: jest.fn(),
  updateSessionStatus: jest.fn(),
  incrementSessionRetry: jest.fn(),
  recordChunk: jest.fn(),
  markChunkAttemptFailed: jest.fn(),
  findChunk: jest.fn(),
  getReceivedChunkIndices: jest.fn(),
  getChunks: jest.fn(),
  recomputeUploadedBytes: jest.fn(),
  deleteSession: jest.fn(),
  purgeExpiredSessions: jest.fn(),
};

const mockChunkStorage: any = {
  onModuleInit: jest.fn(),
  storeChunk: jest.fn(),
  readChunk: jest.fn(),
  verifyChunkOnDisk: jest.fn(),
  chunkExists: jest.fn(),
  deleteChunk: jest.fn(),
  assembleAllChunks: jest.fn(),
  getChunkStream: jest.fn(),
  cleanupSession: jest.fn(),
  cleanupExpired: jest.fn(),
};

const mockEncryption = {
  encryptBuffer: jest.fn((buf: Buffer) => buf),
};

const mockAudit = {
  record: jest.fn(),
};

const mockPrisma: any = {
  evidenceQueueItem: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  createReadStream: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
  readFile: jest.fn(),
  unlink: jest.fn(),
  stat: jest.fn(),
  access: jest.fn(),
  rm: jest.fn(),
  rmdir: jest.fn(),
  readdir: jest.fn(),
}));

describe('ResumableUploadService', () => {
  let service: ResumableUploadService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.createSession.mockImplementation((d: any) =>
      Promise.resolve(baseSession(d)),
    );
    mockRepo.findSessionByOwner.mockImplementation(
      async (id: string, ownerId: string) => {
        if (id !== 'upl-1') return null;
        const s = baseSession();
        s.ownerId = ownerId === 'owner-1' ? ownerId : 'owner-1';
        return s;
      },
    );
    mockRepo.findAllIncompleteSessions.mockResolvedValue([]);
    mockRepo.recomputeUploadedBytes.mockResolvedValue(0);
    mockRepo.updateSessionStatus.mockImplementation(
      async (id, status, extras) => {
        const updated = baseSession();
        Object.assign(updated, extras ?? {});
        updated.status = status;
        return updated;
      },
    );
    mockChunkStorage.storeChunk.mockResolvedValue('/tmp/x/upl-1/chunk-0.bin');
    mockRepo.recordChunk.mockResolvedValue({ id: 'ch-1' } as any);
    mockChunkStorage.cleanupSession.mockResolvedValue(undefined);
    (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);
    service = new ResumableUploadService(
      mockRepo,
      mockChunkStorage,
      mockEncryption,
      mockAudit,
      mockPrisma,
    );
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a pending session with zero progress and valid metadata', async () => {
      const created = baseSession();
      mockRepo.createSession.mockResolvedValue(created);
      const result = await service.create(
        {
          fileName: 'evidence.pdf',
          mimeType: 'application/pdf',
          fileSize: 1500,
          chunkSize: 500,
          maxAttempts: 3,
        },
        'owner-1',
      );
      expect(result).toEqual({
        uploadId: 'upl-1',
        fileName: 'evidence.pdf',
        fileSize: 1500,
        chunkSize: 500,
        totalChunks: 3,
        status: UploadSessionStatus.pending,
        expiresAt: expect.any(Date),
      });
      expect(mockRepo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          maxAttempts: 3,
          totalChunks: 3,
        }),
      );
    });

    it('rejects unsafe fileName / disallowed mime / oversized file', async () => {
      await expect(
        service.create(
          {
            fileName: '../evil.pdf',
            mimeType: 'application/pdf',
            fileSize: 10,
            chunkSize: 10,
          },
          'owner-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(
          {
            fileName: 'f.exe',
            mimeType: 'application/x-msdownload',
            fileSize: 10,
            chunkSize: 10,
          },
          'owner-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(
          {
            fileName: 'huge.pdf',
            mimeType: 'application/pdf',
            fileSize: 200 * 1024 * 1024,
            chunkSize: 1024 * 1024,
          },
          'owner-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── uploadChunk ─────────────────────────────────────────────────────────

  describe('uploadChunk', () => {
    const c0 = makeChunk(500, 0x61);
    const c2 = makeChunk(500, 0x63); // index 2 not last (no trim check needed)

    beforeEach(() => {
      mockRepo.findSessionByOwner.mockResolvedValue(baseSession());
      mockRepo.findChunk.mockResolvedValue(null);
      mockRepo.recomputeUploadedBytes.mockResolvedValue(500);
    });

    it('accepts a valid chunk, transitions pending→uploading, returns accurate progress', async () => {
      const result = await service.uploadChunk(
        'upl-1',
        0,
        sha256(c0),
        c0,
        'owner-1',
      );
      expect(result.received).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(result.uploadedBytes).toBe(500);
      expect(result.progressPercent).toBeCloseTo(500 / 15, 0);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.uploading,
      );
    });

    it('returns duplicate=true when chunk already recorded with matching checksum', async () => {
      mockRepo.findChunk.mockResolvedValue({
        id: 'ch-1',
        uploadedAt: new Date(),
        checksum: sha256(c0),
      });
      const result = await service.uploadChunk(
        'upl-1',
        0,
        sha256(c0),
        c0,
        'owner-1',
      );
      expect(result.duplicate).toBe(true);
      expect(mockRepo.recordChunk).not.toHaveBeenCalled();
    });

    it('throws ConflictException when duplicate chunk has different checksum', async () => {
      mockRepo.findChunk.mockResolvedValue({
        id: 'ch-1',
        uploadedAt: new Date(),
        checksum: 'different-hash',
      });
      await expect(
        service.uploadChunk('upl-1', 0, sha256(c0), c0, 'owner-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects out-of-range index and wrong-size chunks', async () => {
      await expect(
        service.uploadChunk('upl-1', 99, sha256(c0), c0, 'owner-1'),
      ).rejects.toThrow(BadRequestException);
      const small = makeChunk(100, 0x61);
      await expect(
        service.uploadChunk('upl-1', 0, sha256(small), small, 'owner-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects chunk with client/server checksum mismatch', async () => {
      mockRepo.markChunkAttemptFailed.mockResolvedValue(null);
      await expect(
        service.uploadChunk('upl-1', 0, 'badhash', c0, 'owner-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.markChunkAttemptFailed).toHaveBeenCalledWith(
        'upl-1',
        0,
        expect.stringContaining('checksum mismatch'),
      );
    });

    it('rejects access when ownerId does not match', async () => {
      mockRepo.findSessionByOwner.mockImplementation(async (id, ownerId) => {
        if (id !== 'upl-1' || ownerId !== 'owner-1') return null;
        return baseSession();
      });
      await expect(
        service.uploadChunk('upl-1', 0, sha256(c0), c0, 'other'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── partial upload recovery ────────────────────────────────────────────

  describe('partial upload recovery (REQUIREMENT: partial upload recovery)', () => {
    it('getStatus reports received+missing chunks correctly for partial progress', async () => {
      const s = baseSession();
      s.uploadedBytes = 1000;
      s.status = UploadSessionStatus.uploading;
      s.chunks = [
        {
          index: 0,
          size: 500,
          checksum: sha256(makeChunk(500, 0x61)),
          uploadedAt: new Date(),
          attemptCount: 1,
          lastError: null,
        },
        {
          index: 1,
          size: 500,
          checksum: sha256(makeChunk(500, 0x62)),
          uploadedAt: new Date(),
          attemptCount: 1,
          lastError: null,
        },
      ];
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      const status = await service.getStatus('upl-1', 'owner-1');
      expect(status.uploadedBytes).toBe(1000);
      expect(status.progressPercent).toBeCloseTo((1000 / 1500) * 100, 0);
      expect(status.receivedChunks).toEqual([0, 1]);
      expect(status.missingChunks).toEqual([2]);
      expect(status.totalChunks).toBe(3);
    });

    it('finalize rejects when chunks are still missing (prevents premature completion)', async () => {
      const s = baseSession();
      s.chunks = [
        {
          index: 0,
          size: 500,
          checksum: sha256(makeChunk(500, 0x61)),
          uploadedAt: new Date(),
          attemptCount: 1,
          lastError: null,
        },
      ];
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      mockRepo.getReceivedChunkIndices.mockResolvedValue([0]);
      await expect(
        service.finalize('upl-1', 'whatever-hash', 'owner-1'),
      ).rejects.toThrow(/Missing chunks/);
      expect(mockPrisma.evidenceQueueItem.create).not.toHaveBeenCalled();
    });

    it('after uploading only the missing chunks, finalize succeeds (no duplicate chunk uploads)', async () => {
      // Simulate: chunks 0 and 1 already on disk + DB; user only uploads chunk 2
      const c0 = makeChunk(500, 0x61);
      const c1 = makeChunk(500, 0x62);
      const c2 = makeChunk(500, 0x63);
      const combined = Buffer.concat([c0, c1, c2]);
      const wholeFileHash = sha256(combined);

      const s = baseSession();
      s.status = UploadSessionStatus.uploading;
      s.uploadedBytes = 1000;
      s.chunks = [
        {
          index: 0,
          size: 500,
          checksum: sha256(c0),
          uploadedAt: new Date(),
          attemptCount: 1,
          lastError: null,
        },
        {
          index: 1,
          size: 500,
          checksum: sha256(c1),
          uploadedAt: new Date(),
          attemptCount: 1,
          lastError: null,
        },
      ];
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      mockRepo.findChunk.mockImplementation(async (_sid, idx) => {
        if (idx === 0)
          return { id: 'c0', uploadedAt: new Date(), checksum: sha256(c0) };
        if (idx === 1)
          return { id: 'c1', uploadedAt: new Date(), checksum: sha256(c1) };
        return null;
      });
      mockRepo.recomputeUploadedBytes.mockResolvedValue(1500);

      // User uploads only chunk 2 (the missing one):
      await service.uploadChunk('upl-1', 2, sha256(c2), c2, 'owner-1');
      // Verify chunks 0/1 were NOT written again:
      expect(mockChunkStorage.storeChunk).toHaveBeenCalledTimes(1);
      expect(mockChunkStorage.storeChunk).toHaveBeenCalledWith('upl-1', 2, c2);

      // Finalization: assemble (already on disk for 0/1 + new 2)
      mockRepo.getReceivedChunkIndices.mockResolvedValue([0, 1, 2]);
      mockChunkStorage.assembleAllChunks.mockResolvedValue({
        buffer: combined,
        checksums: [sha256(c0), sha256(c1), sha256(c2)],
        sizes: [500, 500, 500],
      });
      mockPrisma.evidenceQueueItem.findFirst.mockResolvedValue(null);
      mockPrisma.evidenceQueueItem.create.mockResolvedValue({
        id: 'ev-1',
        fileName: s.fileName,
      });

      const finalized = await service.finalize(
        'upl-1',
        wholeFileHash,
        'owner-1',
      );
      expect(finalized.status).toBe('completed');
      expect(finalized.fileChecksum).toBe(wholeFileHash);
      expect(finalized.evidenceId).toBe('ev-1');
    });
  });

  // ── integrity validation failure (REQUIREMENT #5) ───────────────────────

  describe('integrity validation failure', () => {
    const c0 = makeChunk(500, 0x61);
    const c1 = makeChunk(500, 0x62);
    const c2 = makeChunk(500, 0x63);
    const correctWhole = Buffer.concat([c0, c1, c2]);

    beforeEach(() => {
      const s = baseSession();
      s.status = UploadSessionStatus.uploading;
      s.uploadedBytes = 1500;
      s.chunks = [
        {
          index: 0,
          size: 500,
          checksum: sha256(c0),
          uploadedAt: new Date(),
          attemptCount: 1,
        },
        {
          index: 1,
          size: 500,
          checksum: sha256(c1),
          uploadedAt: new Date(),
          attemptCount: 1,
        },
        {
          index: 2,
          size: 500,
          checksum: sha256(c2),
          uploadedAt: new Date(),
          attemptCount: 1,
        },
      ];
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      mockRepo.getReceivedChunkIndices.mockResolvedValue([0, 1, 2]);
    });

    it('marks upload FAILED when client-provided whole-file checksum does not match server-computed hash', async () => {
      mockChunkStorage.assembleAllChunks.mockResolvedValue({
        buffer: correctWhole,
        checksums: [sha256(c0), sha256(c1), sha256(c2)],
        sizes: [500, 500, 500],
      });
      await expect(
        service.finalize('upl-1', 'totally-wrong-checksum', 'owner-1'),
      ).rejects.toThrow(/checksum does not match/);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.failed,
        expect.objectContaining({
          failedAt: expect.any(Date),
          lastError: expect.stringContaining('whole-file checksum mismatch'),
        }),
      );
      expect(mockPrisma.evidenceQueueItem.create).not.toHaveBeenCalled();
    });

    it('marks upload FAILED when assembled size differs from declared fileSize', async () => {
      const tooShort = Buffer.concat([c0, c1, makeChunk(400, 0x63)]);
      mockChunkStorage.assembleAllChunks.mockResolvedValue({
        buffer: tooShort,
        checksums: [sha256(c0), sha256(c1), sha256(makeChunk(400, 0x63))],
        sizes: [500, 500, 400],
      });
      await expect(
        service.finalize('upl-1', sha256(tooShort), 'owner-1'),
      ).rejects.toThrow(/size mismatch/);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.failed,
        expect.objectContaining({
          lastError: expect.stringContaining('final size mismatch'),
        }),
      );
    });

    it('marks upload FAILED when per-chunk checksum on disk disagrees with DB record', async () => {
      // Simulate: DB says chunk 1 has checksum sha256(c1), but disk actually has corrupted data.
      const corruptedC1 = makeChunk(500, 0xff);
      const assembled = Buffer.concat([c0, corruptedC1, c2]);
      mockChunkStorage.assembleAllChunks.mockResolvedValue({
        buffer: assembled,
        // The checksums array reflects what's actually on disk (corrupted for 1):
        checksums: [sha256(c0), sha256(corruptedC1), sha256(c2)],
        sizes: [500, 500, 500],
      });
      await expect(
        service.finalize('upl-1', sha256(assembled), 'owner-1'),
      ).rejects.toThrow(/integrity check failed/);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.failed,
        expect.objectContaining({
          lastError: expect.stringMatching(/chunk 1 checksum mismatch/),
        }),
      );
    });
  });

  // ── resume after interruption (REQUIREMENT #3 + #7) ────────────────────

  describe('resume after interruption (cold start recovery)', () => {
    const c0 = makeChunk(500, 0x61);
    const c1 = makeChunk(500, 0x62);

    it('recoverOnStartup scans all incomplete sessions and reconciles disk state', async () => {
      const partial = baseSession();
      partial.status = UploadSessionStatus.uploading;
      partial.uploadedBytes = 1000;
      partial.chunks = [
        {
          index: 0,
          size: 500,
          checksum: sha256(c0),
          uploadedAt: new Date(),
          attemptCount: 1,
        },
        {
          index: 1,
          size: 500,
          checksum: sha256(c1),
          uploadedAt: new Date(),
          attemptCount: 1,
        },
      ];
      mockRepo.findAllIncompleteSessions.mockResolvedValue([partial]);
      mockChunkStorage.verifyChunkOnDisk.mockImplementation(
        async (_sid, idx, expectedCk, expectedSz) => ({
          ok:
            (idx === 0 || idx === 1) &&
            expectedCk === (idx === 0 ? sha256(c0) : sha256(c1)) &&
            expectedSz === 500,
          actualSize: 500,
          actualChecksum: idx === 0 ? sha256(c0) : sha256(c1),
          filePath: `/x/chunk-${idx}.bin`,
        }),
      );
      const recovered = await service.recoverOnStartup();
      expect(recovered).toBe(1);
      // Status was left as uploading since all previously-marked chunks verified ok.
      expect(mockRepo.updateSessionStatus).not.toHaveBeenCalledWith(
        partial.id,
        UploadSessionStatus.paused,
      );
    });

    it('pauses uploads whose chunks are missing/corrupted on disk and marks them for re-upload', async () => {
      const s = baseSession();
      s.status = UploadSessionStatus.uploading;
      s.uploadedBytes = 500;
      s.chunks = [
        { index: 0, size: 500, checksum: sha256(c0), uploadedAt: new Date() },
      ];
      mockRepo.findAllIncompleteSessions.mockResolvedValue([s]);
      mockRepo.findSessionsByOwner.mockResolvedValue([s]);
      // Chunk 0 DB says uploaded, but disk file reports missing (ENOENT):
      mockChunkStorage.verifyChunkOnDisk.mockResolvedValue({
        ok: false,
        actualSize: 0,
        actualChecksum: null,
        filePath: '/x/chunk-0.bin',
      });
      const count = await service.recoverOnStartup();
      expect(count).toBe(1);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.paused,
        expect.objectContaining({
          lastError: expect.stringContaining('missing chunk'),
        }),
      );
    });

    it('listIncompleteForRecovery reconstructs accurate progress % from persisted DB + disk verify', async () => {
      const s = baseSession();
      s.status = UploadSessionStatus.uploading;
      s.uploadedBytes = 500;
      s.chunks = [
        {
          index: 0,
          size: 500,
          checksum: sha256(c0),
          uploadedAt: new Date(),
          attemptCount: 1,
        },
      ];
      mockRepo.findIncompleteSessionsByOwner.mockResolvedValue([s]);
      mockChunkStorage.verifyChunkOnDisk.mockResolvedValue({
        ok: true,
        actualSize: 500,
        actualChecksum: sha256(c0),
        filePath: '/x/chunk-0.bin',
      });
      const [status] = await service.listIncompleteForRecovery('owner-1');
      expect(status.uploadedBytes).toBe(500);
      expect(status.progressPercent).toBeCloseTo((500 / 1500) * 100, 0);
      expect(status.receivedChunks).toEqual([0]);
      expect(status.missingChunks).toEqual([1, 2]);
      expect(status.status).toBe(UploadSessionStatus.uploading);
    });

    it('resume() transitions paused -> uploading and clears lastError', async () => {
      const s = baseSession();
      s.status = UploadSessionStatus.paused;
      s.lastError = 'network timeout';
      s.chunks = [
        {
          index: 0,
          size: 500,
          checksum: sha256(c0),
          uploadedAt: new Date(),
          attemptCount: 1,
        },
      ];
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      mockChunkStorage.verifyChunkOnDisk.mockResolvedValue({
        ok: true,
        actualSize: 500,
        actualChecksum: sha256(c0),
        filePath: '/x/chunk-0.bin',
      });
      const resumed = await service.resume('upl-1', 'owner-1');
      expect(resumed.status).toBe(UploadSessionStatus.uploading);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.uploading,
        expect.objectContaining({ lastError: null }),
      );
    });
  });

  // ── exponential backoff retry (REQUIREMENT #8) ─────────────────────────

  describe('retry with exponential backoff + failure handling', () => {
    it('computeRetryBackoffMs returns capped exponential backoff based on retryCount', async () => {
      const s = baseSession();
      s.retryCount = 0;
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      const first = await service.computeRetryBackoffMs('upl-1', 'owner-1');
      expect(first.attempt).toBe(1);
      expect(first.backoffMs).toBeGreaterThanOrEqual(1000);

      s.retryCount = 3;
      const fourth = await service.computeRetryBackoffMs('upl-1', 'owner-1');
      expect(fourth.backoffMs).toBe(8000);

      s.retryCount = 10; // should be capped
      const capped = await service.computeRetryBackoffMs('upl-1', 'owner-1');
      expect(capped.backoffMs).toBeLessThanOrEqual(60_000);
    });

    it('recordRetryFailure increments count but does NOT mark FAILED before maxAttempts', async () => {
      const s = baseSession();
      s.retryCount = 1;
      s.maxAttempts = 5;
      s.status = UploadSessionStatus.uploading;
      s.chunks = [];
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      mockRepo.incrementSessionRetry.mockResolvedValue({
        ...s,
        retryCount: 2,
        lastError: 'transient network error',
      });
      const next = await service.recordRetryFailure(
        'upl-1',
        'owner-1',
        'transient network error',
      );
      expect(mockRepo.incrementSessionRetry).toHaveBeenCalledWith(
        'upl-1',
        'transient network error',
      );
      expect(next.status).not.toBe(UploadSessionStatus.failed);
    });

    it('recordRetryFailure transitions to FAILED once retryCount >= maxAttempts', async () => {
      const s = baseSession();
      s.retryCount = 4;
      s.maxAttempts = 5;
      s.status = UploadSessionStatus.uploading;
      s.chunks = [];
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      mockRepo.incrementSessionRetry.mockResolvedValue({
        ...s,
        retryCount: 5,
        lastError: 'network timeout again',
      });
      const result = await service.recordRetryFailure(
        'upl-1',
        'owner-1',
        'network timeout again',
      );
      expect(result.status).toBe(UploadSessionStatus.failed);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.failed,
        expect.objectContaining({
          failedAt: expect.any(Date),
          lastError: 'network timeout again',
        }),
      );
    });
  });

  // ── progress restoration accuracy ──────────────────────────────────────

  describe('progress restoration accuracy', () => {
    it('computes progress as uploadedBytes/totalSize rounded to 2 decimals (no fake progress)', async () => {
      const s = baseSession({
        totalSize: 1000,
        chunkSize: 200,
        totalChunks: 5,
        uploadedBytes: 600,
        status: UploadSessionStatus.uploading,
        chunks: [
          {
            index: 0,
            size: 200,
            uploadedAt: new Date(),
            checksum: 'a',
            attemptCount: 1,
          },
          {
            index: 1,
            size: 200,
            uploadedAt: new Date(),
            checksum: 'b',
            attemptCount: 1,
          },
          {
            index: 2,
            size: 200,
            uploadedAt: new Date(),
            checksum: 'c',
            attemptCount: 1,
          },
        ],
      });
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      const status = await service.getStatus('upl-1', 'owner-1');
      expect(status.progressPercent).toBe(60);
      expect(status.uploadedBytes).toBe(600);
      expect(status.receivedChunks).toEqual([0, 1, 2]);
      expect(status.missingChunks).toEqual([3, 4]);
    });

    it('caps progress at exactly 100 when uploadedBytes equals totalSize', async () => {
      const s = baseSession({
        totalSize: 500,
        chunkSize: 500,
        totalChunks: 1,
        uploadedBytes: 9999, // impossible-in-practice; still caps at 100
        status: UploadSessionStatus.uploading,
        chunks: [
          {
            index: 0,
            size: 500,
            uploadedAt: new Date(),
            checksum: 'x',
            attemptCount: 1,
          },
        ],
      });
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      const status = await service.getStatus('upl-1', 'owner-1');
      expect(status.progressPercent).toBe(100);
    });
  });

  // ── pause / abort / ownership guard ────────────────────────────────────

  describe('pause / abort / ownership', () => {
    it('pause transitions uploading→paused and preserves progress', async () => {
      const s = baseSession({
        status: UploadSessionStatus.uploading,
        uploadedBytes: 500,
        chunks: [
          {
            index: 0,
            size: 500,
            uploadedAt: new Date(),
            checksum: 'x',
            attemptCount: 1,
          },
        ],
      });
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      const paused = await service.pause('upl-1', 'owner-1');
      expect(paused.status).toBe(UploadSessionStatus.paused);
      expect(paused.uploadedBytes).toBe(500);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.paused,
      );
    });

    it('abort deletes chunk files and marks aborted (finalized uploads cannot abort)', async () => {
      const s = baseSession({ status: UploadSessionStatus.paused });
      mockRepo.findSessionByOwner.mockResolvedValue(s);
      const result = await service.abort('upl-1', 'owner-1');
      expect(result.ok).toBe(true);
      expect(mockChunkStorage.cleanupSession).toHaveBeenCalledWith('upl-1');
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.aborted,
        expect.anything(),
      );

      const done = baseSession({ status: UploadSessionStatus.completed });
      mockRepo.findSessionByOwner.mockResolvedValue(done);
      await expect(service.abort('upl-1', 'owner-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── expired session guard ──────────────────────────────────────────────

  describe('expired session enforcement', () => {
    it('getStatus rejects for unknown upload or non-owner (ownership + 404)', async () => {
      mockRepo.findSessionByOwner.mockResolvedValue(null);
      await expect(service.getStatus('upl-99', 'owner-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('write operations expire the session when expiresAt passed', async () => {
      const expired = baseSession({
        expiresAt: new Date(Date.now() - 1000),
      });
      mockRepo.findSessionByOwner.mockResolvedValue(expired);
      const c0 = makeChunk(500, 0x61);
      await expect(
        service.uploadChunk('upl-1', 0, sha256(c0), c0, 'owner-1'),
      ).rejects.toThrow(/has expired/);
      expect(mockRepo.updateSessionStatus).toHaveBeenCalledWith(
        'upl-1',
        UploadSessionStatus.expired,
      );
    });
  });
});
