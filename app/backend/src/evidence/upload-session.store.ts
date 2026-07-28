import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../cache/redis.service';
import { UploadSession, UploadSessionStatus, Prisma } from '@prisma/client';

const PREFIX = 'upload';
const sessionKey = (id: string) => `${PREFIX}:session:${id}`;
const chunkKey = (sessionId: string, index: number) =>
  `${PREFIX}:chunk:${sessionId}:${index}`;
const receivedKey = (sessionId: string) => `${PREFIX}:received:${sessionId}`;

export type UploadSessionStoreCreateInput = {
  id?: string;
  ownerId: string;
  orgId?: string | null;
  fileName: string;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedBytes?: number;
  fileChecksum?: string | null;
  status?: UploadSessionStatus;
  retryCount?: number;
  maxAttempts?: number;
  lastError?: string | null;
  lastAttemptAt?: Date | null;
  expiresAt: Date;
  completedAt?: Date | null;
  failedAt?: Date | null;
  metadata?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | null;
};

export type UploadSessionStoreUpdateInput = {
  ownerId?: string;
  orgId?: string | null;
  fileName?: string;
  mimeType?: string;
  totalSize?: number;
  chunkSize?: number;
  totalChunks?: number;
  uploadedBytes?: number | Prisma.IntFieldUpdateOperationsInput;
  fileChecksum?: string | null;
  status?: UploadSessionStatus;
  retryCount?: number | Prisma.IntFieldUpdateOperationsInput;
  maxAttempts?: number;
  lastError?: string | null;
  lastAttemptAt?: Date | null;
  expiresAt?: Date;
  completedAt?: Date | null;
  failedAt?: Date | null;
  metadata?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | null;
};

@Injectable()
export class UploadSessionStore {
  private readonly logger = new Logger(UploadSessionStore.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Session metadata ─────────────────────────────────────────────────────

  /**
   * Retrieve session metadata. Checks Redis first, falls back to Prisma,
   * and caches the result for subsequent reads.
   */
  async getSession(id: string): Promise<UploadSession | null> {
    const cached = await this.redis.get<UploadSession>(sessionKey(id));
    if (cached) return cached;

    const session = await this.prisma.uploadSession.findUnique({
      where: { id },
    });
    if (!session) return null;

    const ttlSeconds = this.ttlSeconds(session.expiresAt);
    if (ttlSeconds > 0) {
      await this.redis.set(sessionKey(id), session, ttlSeconds);
    }
    return session;
  }

  /**
   * Write session metadata to both Redis and Prisma.
   */
  async createSession(
    data: UploadSessionStoreCreateInput,
    ttlSeconds: number,
  ): Promise<UploadSession> {
    const createData: Prisma.UploadSessionCreateInput = {
      id: data.id,
      ownerId: data.ownerId,
      orgId: data.orgId,
      fileName: data.fileName,
      mimeType: data.mimeType,
      totalSize: data.totalSize,
      chunkSize: data.chunkSize,
      totalChunks: data.totalChunks,
      uploadedBytes: data.uploadedBytes ?? 0,
      fileChecksum: data.fileChecksum ?? null,
      status: data.status ?? UploadSessionStatus.pending,
      retryCount: data.retryCount ?? 0,
      maxAttempts: data.maxAttempts ?? 5,
      lastError: data.lastError ?? null,
      lastAttemptAt: data.lastAttemptAt ?? null,
      expiresAt: data.expiresAt,
      completedAt: data.completedAt ?? null,
      failedAt: data.failedAt ?? null,
      metadata:
        data.metadata === null
          ? Prisma.JsonNull
          : (data.metadata ?? Prisma.JsonNull),
    };
    const session = await this.prisma.uploadSession.create({
      data: createData,
    });
    if (ttlSeconds > 0) {
      await this.redis.set(sessionKey(session.id), session, ttlSeconds);
    }
    return session;
  }

  /**
   * Update session status in Prisma and invalidate the Redis cache.
   */
  async updateSessionStatus(
    id: string,
    status: UploadSessionStatus,
  ): Promise<void> {
    await this.prisma.uploadSession.update({
      where: { id },
      data: { status },
    });
    await this.redis.del(sessionKey(id));
  }

  /**
   * Generic update of session fields in Prisma and invalidate Redis cache.
   */
  async updateSession(
    id: string,
    data: UploadSessionStoreUpdateInput,
  ): Promise<void> {
    const updateData: Prisma.UploadSessionUpdateInput = {};
    if (data.ownerId !== undefined) updateData.ownerId = data.ownerId;
    if (data.orgId !== undefined) updateData.orgId = data.orgId;
    if (data.fileName !== undefined) updateData.fileName = data.fileName;
    if (data.mimeType !== undefined) updateData.mimeType = data.mimeType;
    if (data.totalSize !== undefined) updateData.totalSize = data.totalSize;
    if (data.chunkSize !== undefined) updateData.chunkSize = data.chunkSize;
    if (data.totalChunks !== undefined)
      updateData.totalChunks = data.totalChunks;
    if (data.uploadedBytes !== undefined) {
      updateData.uploadedBytes = data.uploadedBytes;
    }
    if (data.fileChecksum !== undefined) {
      updateData.fileChecksum = data.fileChecksum;
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.retryCount !== undefined) updateData.retryCount = data.retryCount;
    if (data.maxAttempts !== undefined)
      updateData.maxAttempts = data.maxAttempts;
    if (data.lastError !== undefined) updateData.lastError = data.lastError;
    if (data.lastAttemptAt !== undefined) {
      updateData.lastAttemptAt = data.lastAttemptAt;
    }
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;
    if (data.completedAt !== undefined)
      updateData.completedAt = data.completedAt;
    if (data.failedAt !== undefined) updateData.failedAt = data.failedAt;
    if (data.metadata !== undefined) {
      updateData.metadata =
        data.metadata === null ? Prisma.JsonNull : data.metadata;
    }
    await this.prisma.uploadSession.update({
      where: { id },
      data: updateData,
    });
    await this.redis.del(sessionKey(id));
  }

  // ── Chunk data ───────────────────────────────────────────────────────────

  /**
   * Store a chunk's binary data in Redis.
   */
  async storeChunk(
    sessionId: string,
    index: number,
    buffer: Buffer,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.setBuffer(chunkKey(sessionId, index), buffer, ttlSeconds);
  }

  /**
   * Retrieve a chunk's binary data from Redis.
   */
  async getChunk(sessionId: string, index: number): Promise<Buffer | null> {
    return this.redis.getBuffer(chunkKey(sessionId, index));
  }

  // ── Chunk registry ───────────────────────────────────────────────────────

  /**
   * Record that a chunk was received (Redis Set + Prisma).
   */
  async addReceivedChunk(
    sessionId: string,
    index: number,
    size: number,
    checksum: string,
    filePath: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.sadd(receivedKey(sessionId), String(index));
    if (ttlSeconds > 0) {
      await this.redis.expire(receivedKey(sessionId), ttlSeconds);
    }

    await this.prisma.uploadChunk.upsert({
      where: { sessionId_index: { sessionId, index } },
      create: { sessionId, index, size, checksum, filePath },
      update: { size, checksum, filePath },
    });
  }

  /**
   * Check if a specific chunk has been received (Redis Set first, then Prisma).
   */
  async isChunkReceived(sessionId: string, index: number): Promise<boolean> {
    const exists = await this.redis.sismember(
      receivedKey(sessionId),
      String(index),
    );
    if (exists) return true;

    const chunk = await this.prisma.uploadChunk.findUnique({
      where: { sessionId_index: { sessionId, index } },
    });
    return chunk !== null;
  }

  /**
   * Check for an existing chunk with a different checksum (conflict detection).
   */
  async getExistingChunkChecksum(
    sessionId: string,
    index: number,
  ): Promise<string | null> {
    const chunk = await this.prisma.uploadChunk.findUnique({
      where: { sessionId_index: { sessionId, index } },
      select: { checksum: true },
    });
    return chunk?.checksum ?? null;
  }

  /**
   * Return all received chunk indices for a session.
   */
  async getReceivedChunks(sessionId: string): Promise<number[]> {
    const members = await this.redis.smembers(receivedKey(sessionId));
    if (members.length > 0) {
      return members.map(Number).sort((a, b) => a - b);
    }

    const chunks = await this.prisma.uploadChunk.findMany({
      where: { sessionId },
      select: { index: true },
      orderBy: { index: 'asc' },
    });
    return chunks.map(c => c.index);
  }

  /**
   * Retrieve all chunk binaries ordered by index (for finalization).
   */
  async getAllChunks(
    sessionId: string,
    totalChunks: number,
  ): Promise<Buffer[]> {
    const buffers: Buffer[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const buf = await this.getChunk(sessionId, i);
      if (!buf) {
        throw new Error(`Chunk ${i} missing from Redis`);
      }
      buffers.push(buf);
    }
    return buffers;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /**
   * Remove all Redis keys associated with a session (chunk data + registry).
   */
  async cleanupSession(sessionId: string, totalChunks: number): Promise<void> {
    const keys: string[] = [receivedKey(sessionId)];
    for (let i = 0; i < totalChunks; i++) {
      keys.push(chunkKey(sessionId, i));
    }
    await Promise.allSettled(keys.map(k => this.redis.del(k)));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private ttlSeconds(expiresAt: Date): number {
    const ms = expiresAt.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  }
}
