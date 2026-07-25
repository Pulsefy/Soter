import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AuditService } from '../audit/audit.service';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { UploadSessionStatus } from '@prisma/client';
import { CreateUploadSessionDto } from './upload-session.dto';
import { UploadSessionStore } from './upload-session.store';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  isSafeFilename,
} from './file-validation';

/** Sessions expire after 24 hours of inactivity. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = Math.ceil(SESSION_TTL_MS / 1000);

@Injectable()
export class UploadSessionService {
  private readonly logger = new Logger(UploadSessionService.name);
  private readonly evidenceDir = path.join(
    process.cwd(),
    'uploads',
    'evidence',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly store: UploadSessionStore,
  ) {
    if (!existsSync(this.evidenceDir))
      mkdirSync(this.evidenceDir, { recursive: true });
  }

  async create(dto: CreateUploadSessionDto, ownerId: string, orgId?: string) {
    if (!isSafeFilename(dto.fileName)) {
      throw new BadRequestException('Invalid fileName');
    }
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(dto.mimeType)) {
      throw new BadRequestException(`Disallowed mimeType: ${dto.mimeType}`);
    }
    if (dto.totalSize > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `totalSize exceeds maximum of ${MAX_FILE_SIZE} bytes`,
      );
    }

    const totalChunks = Math.ceil(dto.totalSize / dto.chunkSize);

    const session = await this.store.createSession(
      {
        ownerId,
        orgId: orgId ?? null,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        totalSize: dto.totalSize,
        chunkSize: dto.chunkSize,
        totalChunks,
        status: UploadSessionStatus.active,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
      SESSION_TTL_SECONDS,
    );

    await this.auditService.record({
      actorId: ownerId,
      entity: 'upload_session',
      entityId: session.id,
      action: 'session_created',
      metadata: {
        fileName: dto.fileName,
        totalSize: dto.totalSize,
        totalChunks,
      },
    });

    return session;
  }

  async uploadChunk(
    sessionId: string,
    index: number,
    checksum: string,
    buffer: Buffer,
    ownerId: string,
  ) {
    const session = await this.getActiveSession(sessionId, ownerId);

    if (index < 0 || index >= session.totalChunks) {
      throw new BadRequestException(
        `Chunk index ${index} out of range [0, ${session.totalChunks - 1}]`,
      );
    }

    // Idempotency: if this chunk was already received, return it as-is.
    const existingChecksum = await this.store.getExistingChunkChecksum(
      sessionId,
      index,
    );
    if (existingChecksum) {
      if (existingChecksum !== checksum) {
        throw new ConflictException(
          `Chunk ${index} already uploaded with a different checksum`,
        );
      }
      return { sessionId, index, received: true, duplicate: true };
    }

    // Validate chunk size
    const isLastChunk = index === session.totalChunks - 1;
    const expectedSize = isLastChunk
      ? session.totalSize - session.chunkSize * (session.totalChunks - 1)
      : session.chunkSize;

    if (buffer.length !== expectedSize) {
      throw new BadRequestException(
        `Chunk ${index} size mismatch: expected ${expectedSize}, got ${buffer.length}`,
      );
    }

    // Verify checksum
    const actualChecksum = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex');
    if (actualChecksum !== checksum) {
      throw new BadRequestException(`Chunk ${index} checksum mismatch`);
    }

    // Persist chunk to Redis and record in Prisma
    const chunkPath = `redis:chunk:${sessionId}:${index}`;
    await Promise.all([
      this.store.storeChunk(sessionId, index, buffer, SESSION_TTL_SECONDS),
      this.store.addReceivedChunk(
        sessionId,
        index,
        buffer.length,
        checksum,
        chunkPath,
        SESSION_TTL_SECONDS,
      ),
    ]);

    return { sessionId, index, received: true, duplicate: false };
  }

  async finalize(sessionId: string, ownerId: string) {
    const session = await this.getActiveSession(sessionId, ownerId);

    const receivedIndices = await this.store.getReceivedChunks(sessionId);

    if (receivedIndices.length !== session.totalChunks) {
      const missing = Array.from(
        { length: session.totalChunks },
        (_, i) => i,
      ).filter(i => !receivedIndices.includes(i));
      throw new BadRequestException(`Missing chunks: [${missing.join(', ')}]`);
    }

    // Reassemble from Redis
    const parts = await this.store.getAllChunks(sessionId, session.totalChunks);
    const assembled = Buffer.concat(parts);

    // Encrypt and persist as a regular evidence file
    const encrypted = this.encryptionService.encryptBuffer(assembled);
    const evidenceFile = path.join(
      this.evidenceDir,
      `${crypto.randomUUID()}.enc`,
    );
    await fs.writeFile(evidenceFile, encrypted);

    const fileHash = crypto
      .createHash('sha256')
      .update(assembled)
      .digest('hex');

    // Check for exact duplicate in evidence queue
    const duplicate = await this.prisma.evidenceQueueItem.findFirst({
      where: { fileHash, ...(session.orgId ? { orgId: session.orgId } : {}) },
    });
    if (duplicate) {
      await fs.unlink(evidenceFile);
      await this.store.updateSessionStatus(
        sessionId,
        UploadSessionStatus.completed,
      );
      await this.store.cleanupSession(sessionId, session.totalChunks);
      throw new ConflictException('File already exists in evidence queue');
    }

    const item = await this.prisma.evidenceQueueItem.create({
      data: {
        fileName: session.fileName,
        filePath: evidenceFile,
        fileHash,
        mimeType: session.mimeType,
        size: assembled.length,
        ownerId,
        orgId: session.orgId ?? undefined,
        status: 'pending',
      },
    });

    await this.store.updateSessionStatus(
      sessionId,
      UploadSessionStatus.completed,
    );
    await this.store.cleanupSession(sessionId, session.totalChunks);

    await this.auditService.record({
      actorId: ownerId,
      entity: 'upload_session',
      entityId: sessionId,
      action: 'session_finalized',
      metadata: { evidenceId: item.id, fileName: session.fileName },
    });

    return item;
  }

  /** Returns the upload status so clients can resume after a disconnect. */
  async getStatus(sessionId: string, ownerId: string) {
    const session = await this.getActiveSession(sessionId, ownerId);
    const receivedChunks = await this.store.getReceivedChunks(sessionId);
    return {
      sessionId,
      totalChunks: session.totalChunks,
      receivedChunks,
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async getActiveSession(sessionId: string, ownerId: string) {
    const session = await this.store.getSession(sessionId);
    if (!session) throw new NotFoundException('Upload session not found');
    if (session.ownerId !== ownerId) throw new ForbiddenException();
    if (session.status !== UploadSessionStatus.active) {
      throw new BadRequestException(`Session is ${session.status}`);
    }
    if (session.expiresAt < new Date()) {
      await this.store.updateSessionStatus(
        sessionId,
        UploadSessionStatus.expired,
      );
      throw new BadRequestException('Session has expired');
    }
    return session;
  }
}
