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
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  isSafeFilename,
} from './file-validation';

/** Sessions expire after 24 hours of inactivity. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class UploadSessionService {
  private readonly logger = new Logger(UploadSessionService.name);
  private readonly chunksDir = path.join(process.cwd(), 'uploads', 'chunks');
  private readonly evidenceDir = path.join(
    process.cwd(),
    'uploads',
    'evidence',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
  ) {
    for (const dir of [this.chunksDir, this.evidenceDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
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

    const session = await this.prisma.uploadSession.create({
      data: {
        ownerId,
        orgId,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        totalSize: dto.totalSize,
        chunkSize: dto.chunkSize,
        totalChunks,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

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
    const existing = await this.prisma.uploadChunk.findUnique({
      where: { sessionId_index: { sessionId, index } },
    });
    if (existing) {
      if (existing.checksum !== checksum) {
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

    // Persist chunk to disk
    const chunkFile = path.join(this.chunksDir, `${sessionId}-${index}`);
    await fs.writeFile(chunkFile, buffer);

    await this.prisma.uploadChunk.create({
      data: {
        sessionId,
        index,
        size: buffer.length,
        checksum,
        filePath: chunkFile,
      },
    });

    return { sessionId, index, received: true, duplicate: false };
  }

  async finalize(sessionId: string, ownerId: string) {
    const session = await this.getActiveSession(sessionId, ownerId);

    const chunks = await this.prisma.uploadChunk.findMany({
      where: { sessionId },
      orderBy: { index: 'asc' },
    });

    if (chunks.length !== session.totalChunks) {
      const missing = Array.from(
        { length: session.totalChunks },
        (_, i) => i,
      ).filter(i => !chunks.find(c => c.index === i));
      throw new BadRequestException(`Missing chunks: [${missing.join(', ')}]`);
    }

    // Reassemble
    const parts = await Promise.all(chunks.map(c => fs.readFile(c.filePath)));
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
      await this.markSessionCompleted(sessionId);
      await this.cleanupChunks(chunks.map(c => c.filePath));
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

    await this.markSessionCompleted(sessionId);
    await this.cleanupChunks(chunks.map(c => c.filePath));

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
    const chunks = await this.prisma.uploadChunk.findMany({
      where: { sessionId },
      select: { index: true },
      orderBy: { index: 'asc' },
    });
    return {
      sessionId,
      totalChunks: session.totalChunks,
      receivedChunks: chunks.map(c => c.index),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async getActiveSession(sessionId: string, ownerId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Upload session not found');
    if (session.ownerId !== ownerId) throw new ForbiddenException();
    if (session.status !== UploadSessionStatus.active) {
      throw new BadRequestException(`Session is ${session.status}`);
    }
    if (session.expiresAt < new Date()) {
      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: UploadSessionStatus.expired },
      });
      throw new BadRequestException('Session has expired');
    }
    return session;
  }

  private async markSessionCompleted(sessionId: string) {
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.completed },
    });
  }

  private async cleanupChunks(filePaths: string[]) {
    await Promise.allSettled(filePaths.map(p => fs.unlink(p)));
  }
}
