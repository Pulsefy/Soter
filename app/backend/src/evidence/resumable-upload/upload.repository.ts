import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UploadSession,
  UploadChunk,
  UploadSessionStatus,
  ChunkStorageBackend,
  Prisma,
} from '@prisma/client';

export type SessionWithOptionalChunks = UploadSession & {
  chunks?: UploadChunk[];
};

export type SessionWithRequiredChunks = UploadSession & {
  chunks: UploadChunk[];
};

export type SessionCreateInput = {
  ownerId: string;
  orgId: string | null;
  fileName: string;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  expiresAt: Date;
  maxAttempts: number;
  fileChecksum?: string | null;
  metadata?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | null;
};

export type ChunkRecordInput = {
  sessionId: string;
  index: number;
  size: number;
  checksum: string;
  filePath: string;
  storageBackend?: ChunkStorageBackend;
};

@Injectable()
export class UploadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: SessionCreateInput): Promise<UploadSession> {
    const data: Prisma.UploadSessionCreateInput = {
      ownerId: input.ownerId,
      orgId: input.orgId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      totalSize: input.totalSize,
      chunkSize: input.chunkSize,
      totalChunks: input.totalChunks,
      status: UploadSessionStatus.pending,
      uploadedBytes: 0,
      expiresAt: input.expiresAt,
      maxAttempts: input.maxAttempts,
      fileChecksum: input.fileChecksum ?? null,
      metadata: input.metadata ?? Prisma.JsonNull,
    };
    return this.prisma.uploadSession.create({ data });
  }

  async findSessionById(id: string): Promise<SessionWithRequiredChunks | null> {
    return this.prisma.uploadSession.findUnique({
      where: { id },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
  }

  async findSessionByOwner(
    id: string,
    ownerId: string,
  ): Promise<SessionWithRequiredChunks | null> {
    return this.prisma.uploadSession.findFirst({
      where: { id, ownerId },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
  }

  async findIncompleteSessionsByOwner(
    ownerId: string,
  ): Promise<SessionWithRequiredChunks[]> {
    const incomplete: UploadSessionStatus[] = [
      UploadSessionStatus.pending,
      UploadSessionStatus.uploading,
      UploadSessionStatus.paused,
      UploadSessionStatus.failed,
    ];
    return this.prisma.uploadSession.findMany({
      where: {
        ownerId,
        status: { in: incomplete },
        expiresAt: { gt: new Date() },
      },
      include: { chunks: { orderBy: { index: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllIncompleteSessions(): Promise<SessionWithRequiredChunks[]> {
    const incomplete: UploadSessionStatus[] = [
      UploadSessionStatus.pending,
      UploadSessionStatus.uploading,
      UploadSessionStatus.paused,
      UploadSessionStatus.failed,
    ];
    return this.prisma.uploadSession.findMany({
      where: {
        status: { in: incomplete },
        expiresAt: { gt: new Date() },
      },
      include: { chunks: { orderBy: { index: 'asc' } } },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async findSessionsByOwner(
    ownerId: string,
    limit = 50,
  ): Promise<SessionWithRequiredChunks[]> {
    return this.prisma.uploadSession.findMany({
      where: { ownerId },
      include: { chunks: { orderBy: { index: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async updateSessionStatus(
    id: string,
    status: UploadSessionStatus,
    extras: Partial<{
      lastError: string | null;
      lastAttemptAt: Date;
      completedAt: Date | null;
      failedAt: Date | null;
      retryCount: number;
      uploadedBytes: number;
      fileChecksum: string | null;
    }> = {},
  ): Promise<SessionWithRequiredChunks> {
    const now = new Date();
    const data: Prisma.UploadSessionUpdateInput = {
      status,
      lastAttemptAt: extras.lastAttemptAt ?? now,
      lastError: extras.lastError !== undefined ? extras.lastError : undefined,
      completedAt:
        extras.completedAt !== undefined ? extras.completedAt : undefined,
      failedAt: extras.failedAt !== undefined ? extras.failedAt : undefined,
      retryCount:
        extras.retryCount !== undefined ? extras.retryCount : undefined,
      uploadedBytes:
        extras.uploadedBytes !== undefined ? extras.uploadedBytes : undefined,
      fileChecksum:
        extras.fileChecksum !== undefined ? extras.fileChecksum : undefined,
    };
    return this.prisma.uploadSession.update({
      where: { id },
      data,
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
  }

  async incrementSessionRetry(
    id: string,
    lastError: string | null,
  ): Promise<SessionWithRequiredChunks> {
    return this.prisma.uploadSession.update({
      where: { id },
      data: {
        retryCount: { increment: 1 },
        lastAttemptAt: new Date(),
        lastError,
      },
      include: { chunks: { orderBy: { index: 'asc' } } },
    });
  }

  async recordChunk(input: ChunkRecordInput): Promise<UploadChunk> {
    const now = new Date();
    return this.prisma.uploadChunk.upsert({
      where: {
        sessionId_index: {
          sessionId: input.sessionId,
          index: input.index,
        },
      },
      create: {
        sessionId: input.sessionId,
        index: input.index,
        size: input.size,
        checksum: input.checksum,
        filePath: input.filePath,
        storageBackend: input.storageBackend ?? ChunkStorageBackend.disk,
        attemptCount: 1,
        uploadedAt: now,
      },
      update: {
        size: input.size,
        checksum: input.checksum,
        filePath: input.filePath,
        storageBackend: input.storageBackend ?? ChunkStorageBackend.disk,
        attemptCount: { increment: 1 },
        lastError: null,
        uploadedAt: now,
      },
    });
  }

  async markChunkAttemptFailed(
    sessionId: string,
    index: number,
    errorMsg: string,
  ): Promise<UploadChunk | null> {
    const existing = await this.prisma.uploadChunk.findUnique({
      where: { sessionId_index: { sessionId, index } },
    });
    if (!existing) {
      return this.prisma.uploadChunk.create({
        data: {
          sessionId,
          index,
          size: 0,
          checksum: '',
          filePath: '',
          storageBackend: ChunkStorageBackend.disk,
          attemptCount: 1,
          lastError: errorMsg,
          uploadedAt: null,
        },
      });
    }
    return this.prisma.uploadChunk.update({
      where: { sessionId_index: { sessionId, index } },
      data: {
        attemptCount: { increment: 1 },
        lastError: errorMsg,
      },
    });
  }

  async findChunk(
    sessionId: string,
    index: number,
  ): Promise<UploadChunk | null> {
    return this.prisma.uploadChunk.findUnique({
      where: { sessionId_index: { sessionId, index } },
    });
  }

  async getReceivedChunkIndices(sessionId: string): Promise<number[]> {
    const rows = await this.prisma.uploadChunk.findMany({
      where: { sessionId, uploadedAt: { not: null } },
      select: { index: true },
      orderBy: { index: 'asc' },
    });
    return rows.map(r => r.index);
  }

  async getChunks(sessionId: string): Promise<UploadChunk[]> {
    return this.prisma.uploadChunk.findMany({
      where: { sessionId },
      orderBy: { index: 'asc' },
    });
  }

  async recomputeUploadedBytes(sessionId: string): Promise<number> {
    const result = await this.prisma.uploadChunk.aggregate({
      where: { sessionId, uploadedAt: { not: null } },
      _sum: { size: true },
    });
    const uploaded = result._sum.size ?? 0;
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { uploadedBytes: uploaded },
    });
    return uploaded;
  }

  async deleteSession(id: string): Promise<void> {
    await this.prisma.uploadSession.delete({ where: { id } });
  }

  async purgeExpiredSessions(cutoff: Date): Promise<number> {
    const result = await this.prisma.uploadSession.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return result.count;
  }
}
