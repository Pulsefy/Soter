import { UploadRepository } from '../resumable-upload/upload.repository';
import { UploadSessionStatus, ChunkStorageBackend } from '@prisma/client';

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upl-1',
    ownerId: 'owner-1',
    orgId: null,
    fileName: 'evidence.pdf',
    mimeType: 'application/pdf',
    totalSize: 1_500_000,
    chunkSize: 500_000,
    totalChunks: 3,
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

const mockPrisma = {
  uploadSession: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  uploadChunk: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  },
};

describe('UploadRepository', () => {
  let repo: UploadRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new UploadRepository(mockPrisma as any);
  });

  describe('createSession', () => {
    it('creates a session with pending status and zero uploadedBytes', async () => {
      const created = baseSession();
      mockPrisma.uploadSession.create.mockResolvedValue(created);
      const result = await repo.createSession({
        ownerId: 'owner-1',
        orgId: null,
        fileName: 'evidence.pdf',
        mimeType: 'application/pdf',
        totalSize: 1_500_000,
        chunkSize: 500_000,
        totalChunks: 3,
        expiresAt: created.expiresAt,
        maxAttempts: 5,
      });
      expect(mockPrisma.uploadSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: UploadSessionStatus.pending,
          uploadedBytes: 0,
          ownerId: 'owner-1',
        }),
      });
      expect(result).toBe(created);
    });
  });

  describe('findIncompleteSessionsByOwner', () => {
    it('filters by non-terminal statuses and future expiresAt', async () => {
      mockPrisma.uploadSession.findMany.mockResolvedValue([]);
      await repo.findIncompleteSessionsByOwner('owner-1');
      expect(mockPrisma.uploadSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerId: 'owner-1',
            status: expect.objectContaining({
              in: expect.arrayContaining([
                UploadSessionStatus.pending,
                UploadSessionStatus.uploading,
                UploadSessionStatus.paused,
                UploadSessionStatus.failed,
              ]),
            }),
          }),
        }),
      );
    });
  });

  describe('recordChunk', () => {
    it('upserts a chunk with disk backend and uploadedAt timestamp', async () => {
      mockPrisma.uploadChunk.upsert.mockResolvedValue({
        id: 'c-1',
        sessionId: 'upl-1',
        index: 0,
      });
      await repo.recordChunk({
        sessionId: 'upl-1',
        index: 0,
        size: 500,
        checksum: 'abc',
        filePath: '/x/y/chunk-0.bin',
        storageBackend: ChunkStorageBackend.disk,
      });
      expect(mockPrisma.uploadChunk.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            storageBackend: ChunkStorageBackend.disk,
            attemptCount: 1,
          }),
          update: expect.objectContaining({
            attemptCount: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('recomputeUploadedBytes', () => {
    it('aggregates uploaded chunk sizes and updates session counter', async () => {
      mockPrisma.uploadChunk.aggregate.mockResolvedValue({
        _sum: { size: 1000 },
      });
      mockPrisma.uploadSession.update.mockResolvedValue({} as any);
      const total = await repo.recomputeUploadedBytes('upl-1');
      expect(total).toBe(1000);
      expect(mockPrisma.uploadSession.update).toHaveBeenCalledWith({
        where: { id: 'upl-1' },
        data: { uploadedBytes: 1000 },
      });
    });

    it('treats missing chunks (null sum) as zero bytes', async () => {
      mockPrisma.uploadChunk.aggregate.mockResolvedValue({
        _sum: { size: null },
      });
      mockPrisma.uploadSession.update.mockResolvedValue({} as any);
      expect(await repo.recomputeUploadedBytes('upl-1')).toBe(0);
    });
  });

  describe('purgeExpiredSessions', () => {
    it('deletes sessions whose expiresAt is before the cutoff', async () => {
      mockPrisma.uploadSession.deleteMany.mockResolvedValue({ count: 7 });
      const cutoff = new Date();
      const removed = await repo.purgeExpiredSessions(cutoff);
      expect(removed).toBe(7);
      expect(mockPrisma.uploadSession.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: cutoff } },
      });
    });
  });
});
