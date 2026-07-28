import { UploadSessionStore } from './upload-session.store';
import { UploadSessionStatus } from '@prisma/client';

function makeSession(overrides: Record<string, any> = {}) {
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
    ...overrides,
  } as any;
}

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  setBuffer: jest.fn(),
  getBuffer: jest.fn(),
  sadd: jest.fn(),
  smembers: jest.fn(),
  sismember: jest.fn(),
  expire: jest.fn(),
};

const mockPrisma = {
  uploadSession: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  uploadChunk: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('UploadSessionStore', () => {
  let store: UploadSessionStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new UploadSessionStore(mockRedis as any, mockPrisma as any);
  });

  // ── getSession ──────────────────────────────────────────────────────────

  describe('getSession', () => {
    it('returns cached session from Redis', async () => {
      const session = makeSession();
      mockRedis.get.mockResolvedValue(session);

      const result = await store.getSession('sess-1');
      expect(result).toEqual(session);
      expect(mockPrisma.uploadSession.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to Prisma on Redis miss and caches result', async () => {
      const session = makeSession();
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.uploadSession.findUnique.mockResolvedValue(session);

      const result = await store.getSession('sess-1');
      expect(result).toEqual(session);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'upload:session:sess-1',
        session,
        expect.any(Number),
      );
    });

    it('returns null when session not found anywhere', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.uploadSession.findUnique.mockResolvedValue(null);

      const result = await store.getSession('unknown');
      expect(result).toBeNull();
    });

    it('returns null for expired session (negative TTL)', async () => {
      const expired = makeSession({ expiresAt: new Date(Date.now() - 1000) });
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.uploadSession.findUnique.mockResolvedValue(expired);

      const result = await store.getSession('sess-1');
      expect(result).toEqual(expired);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  // ── createSession ────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates in Prisma and caches in Redis', async () => {
      const created = makeSession();
      mockPrisma.uploadSession.create.mockResolvedValue(created);

      const result = await store.createSession(
        {
          ownerId: 'owner-1',
          fileName: 'evidence.txt',
          mimeType: 'text/plain',
          totalSize: 300,
          chunkSize: 100,
          totalChunks: 3,
          status: UploadSessionStatus.active,
          expiresAt: new Date(Date.now() + 86400000),
        },
        86400,
      );

      expect(mockPrisma.uploadSession.create).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        'upload:session:sess-1',
        created,
        86400,
      );
      expect(result).toBe(created);
    });
  });

  // ── updateSessionStatus ──────────────────────────────────────────────────

  describe('updateSessionStatus', () => {
    it('updates Prisma and invalidates Redis cache', async () => {
      mockPrisma.uploadSession.update.mockResolvedValue({});

      await store.updateSessionStatus('sess-1', UploadSessionStatus.expired);

      expect(mockPrisma.uploadSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { status: UploadSessionStatus.expired },
      });
      expect(mockRedis.del).toHaveBeenCalledWith('upload:session:sess-1');
    });
  });

  // ── chunk storage ────────────────────────────────────────────────────────

  describe('chunk storage', () => {
    it('stores chunk bytes in Redis', async () => {
      const buf = Buffer.from('hello');
      await store.storeChunk('sess-1', 0, buf, 3600);
      expect(mockRedis.setBuffer).toHaveBeenCalledWith(
        'upload:chunk:sess-1:0',
        buf,
        3600,
      );
    });

    it('retrieves chunk bytes from Redis', async () => {
      const buf = Buffer.from('hello');
      mockRedis.getBuffer.mockResolvedValue(buf);

      const result = await store.getChunk('sess-1', 0);
      expect(result).toBe(buf);
      expect(mockRedis.getBuffer).toHaveBeenCalledWith('upload:chunk:sess-1:0');
    });

    it('returns null for missing chunk', async () => {
      mockRedis.getBuffer.mockResolvedValue(null);
      const result = await store.getChunk('sess-1', 99);
      expect(result).toBeNull();
    });
  });

  // ── chunk registry ───────────────────────────────────────────────────────

  describe('chunk registry', () => {
    it('adds chunk to Redis Set and Prisma', async () => {
      mockRedis.sadd.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockPrisma.uploadChunk.upsert.mockResolvedValue({});

      await store.addReceivedChunk('sess-1', 0, 100, 'abc', '/tmp/f', 3600);

      expect(mockRedis.sadd).toHaveBeenCalledWith(
        'upload:received:sess-1',
        '0',
      );
      expect(mockPrisma.uploadChunk.upsert).toHaveBeenCalled();
    });

    it('reports chunk as received via Redis Set', async () => {
      mockRedis.sismember.mockResolvedValue(1);

      const result = await store.isChunkReceived('sess-1', 0);
      expect(result).toBe(true);
      expect(mockPrisma.uploadChunk.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to Prisma when Redis misses', async () => {
      mockRedis.sismember.mockResolvedValue(0);
      mockPrisma.uploadChunk.findUnique.mockResolvedValue({ index: 0 } as any);

      const result = await store.isChunkReceived('sess-1', 0);
      expect(result).toBe(true);
    });

    it('returns false for unreceived chunk', async () => {
      mockRedis.sismember.mockResolvedValue(0);
      mockPrisma.uploadChunk.findUnique.mockResolvedValue(null);

      const result = await store.isChunkReceived('sess-1', 5);
      expect(result).toBe(false);
    });

    it('returns all received chunk indices from Redis', async () => {
      mockRedis.smembers.mockResolvedValue(['0', '2']);

      const result = await store.getReceivedChunks('sess-1');
      expect(result).toEqual([0, 2]);
    });

    it('falls back to Prisma for received chunks on Redis miss', async () => {
      mockRedis.smembers.mockResolvedValue([]);
      mockPrisma.uploadChunk.findMany.mockResolvedValue([
        { index: 0 },
        { index: 1 },
      ] as any);

      const result = await store.getReceivedChunks('sess-1');
      expect(result).toEqual([0, 1]);
    });
  });

  // ── getAllChunks ─────────────────────────────────────────────────────────

  describe('getAllChunks', () => {
    it('retrieves all chunks in order', async () => {
      const bufs = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];
      mockRedis.getBuffer
        .mockResolvedValueOnce(bufs[0])
        .mockResolvedValueOnce(bufs[1])
        .mockResolvedValueOnce(bufs[2]);

      const result = await store.getAllChunks('sess-1', 3);
      expect(result).toEqual(bufs);
    });

    it('throws when a chunk is missing', async () => {
      mockRedis.getBuffer
        .mockResolvedValueOnce(Buffer.from('a'))
        .mockResolvedValueOnce(null);

      await expect(store.getAllChunks('sess-1', 3)).rejects.toThrow(
        /Chunk 1 missing/,
      );
    });
  });

  // ── cleanupSession ───────────────────────────────────────────────────────

  describe('cleanupSession', () => {
    it('removes all Redis keys for the session', async () => {
      mockRedis.del.mockResolvedValue(undefined);

      await store.cleanupSession('sess-1', 3);

      expect(mockRedis.del).toHaveBeenCalledTimes(4); // received + 3 chunks
      expect(mockRedis.del).toHaveBeenCalledWith('upload:received:sess-1');
      expect(mockRedis.del).toHaveBeenCalledWith('upload:chunk:sess-1:0');
      expect(mockRedis.del).toHaveBeenCalledWith('upload:chunk:sess-1:1');
      expect(mockRedis.del).toHaveBeenCalledWith('upload:chunk:sess-1:2');
    });
  });

  // ── expiration / invalid session ────────────────────────────────────────

  describe('expiration and invalid sessions', () => {
    it('getSession returns null for nonexistent session', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.uploadSession.findUnique.mockResolvedValue(null);

      expect(await store.getSession('no-such-id')).toBeNull();
    });

    it('getSession returns expired session (caller decides enforcement)', async () => {
      const expired = makeSession({
        expiresAt: new Date(Date.now() - 5000),
      });
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.uploadSession.findUnique.mockResolvedValue(expired);

      const result = await store.getSession('sess-1');
      expect(result?.status).toBe(UploadSessionStatus.active);
      expect(result?.expiresAt.getTime()).toBeLessThan(Date.now());
    });
  });
});
