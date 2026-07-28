import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  UploadSession,
  UploadChunk,
  UploadSessionStatus,
  ChunkStorageBackend,
  EvidenceStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import {
  UploadRepository,
  SessionWithOptionalChunks,
  SessionWithRequiredChunks,
} from './upload.repository';
import { ChunkStorageService } from './chunk-storage.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  isSafeFilename,
} from '../file-validation';
import {
  CreateResumableUploadDto,
  UploadCreatedResponse,
  ChunkReceivedResponse,
  UploadStatusResponse,
  UploadChunkMeta,
  FinalizedResponse,
  UploadListResponse,
} from './dto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

export type SessionWithChunks = SessionWithOptionalChunks;

export type VerificationFailure =
  | { type: 'missing_chunk'; index: number }
  | { type: 'size_mismatch'; index: number; expected: number; actual: number }
  | {
      type: 'checksum_mismatch';
      index: number;
      expected: string;
      actual: string | null;
    };

@Injectable()
export class ResumableUploadService implements OnModuleInit {
  private readonly logger = new Logger(ResumableUploadService.name);
  private readonly evidenceDir = path.join(
    process.cwd(),
    'uploads',
    'evidence',
  );

  constructor(
    private readonly repo: UploadRepository,
    private readonly chunkStorage: ChunkStorageService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {
    if (!existsSync(this.evidenceDir)) {
      mkdirSync(this.evidenceDir, { recursive: true });
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      const recovered = await this.recoverOnStartup();
      if (recovered > 0) {
        this.logger.log(
          `Startup recovery: reconciled ${recovered} incomplete upload sessions`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Startup recovery failed: ${message}`, stack);
    }
  }

  async create(
    dto: CreateResumableUploadDto,
    ownerId: string,
    orgId?: string,
  ): Promise<UploadCreatedResponse> {
    if (!isSafeFilename(dto.fileName)) {
      throw new BadRequestException('Invalid fileName');
    }
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(dto.mimeType)) {
      throw new BadRequestException(`Disallowed mimeType: ${dto.mimeType}`);
    }
    if (dto.fileSize > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `fileSize exceeds maximum of ${MAX_FILE_SIZE} bytes`,
      );
    }
    const chunkSize = dto.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (chunkSize <= 0) {
      throw new BadRequestException('chunkSize must be positive');
    }
    const totalChunks = Math.ceil(dto.fileSize / chunkSize);
    if (totalChunks <= 0) {
      throw new BadRequestException('fileSize is too small for chunkSize');
    }

    const session = await this.repo.createSession({
      ownerId,
      orgId: orgId ?? null,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      totalSize: dto.fileSize,
      chunkSize,
      totalChunks,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      maxAttempts: dto.maxAttempts,
      metadata: dto.claimId ? { claimId: dto.claimId } : null,
    });

    await this.audit.record({
      actorId: ownerId,
      entity: 'resumable_upload',
      entityId: session.id,
      action: 'upload_created',
      metadata: {
        fileName: dto.fileName,
        fileSize: dto.fileSize,
        chunkSize,
        totalChunks,
        orgId: orgId ?? null,
      },
    });

    return {
      uploadId: session.id,
      fileName: session.fileName,
      fileSize: session.totalSize,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      status: session.status,
      expiresAt: session.expiresAt,
    };
  }

  async uploadChunk(
    uploadId: string,
    index: number,
    clientChecksum: string,
    buffer: Buffer,
    ownerId: string,
  ): Promise<ChunkReceivedResponse> {
    const session = await this.getWritableSession(uploadId, ownerId);
    if (index < 0 || index >= session.totalChunks) {
      throw new BadRequestException(
        `Chunk index ${index} out of range [0, ${session.totalChunks - 1}]`,
      );
    }

    const isLastChunk = index === session.totalChunks - 1;
    const expectedSize = isLastChunk
      ? session.totalSize - session.chunkSize * (session.totalChunks - 1)
      : session.chunkSize;
    if (buffer.length !== expectedSize) {
      throw new BadRequestException(
        `Chunk ${index} size mismatch: expected ${expectedSize}, got ${buffer.length}`,
      );
    }

    const actualChecksum = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex');
    if (actualChecksum !== clientChecksum) {
      await this.repo.markChunkAttemptFailed(
        uploadId,
        index,
        `client checksum mismatch: expected ${clientChecksum}, got ${actualChecksum}`,
      );
      throw new BadRequestException(`Chunk ${index} checksum mismatch`);
    }

    const existing = await this.repo.findChunk(uploadId, index);
    if (existing && existing.uploadedAt) {
      if (existing.checksum !== actualChecksum) {
        throw new ConflictException(
          `Chunk ${index} already uploaded with a different checksum`,
        );
      }
      return this.buildChunkResponse(session, index, true, true);
    }

    const filePath = await this.chunkStorage.storeChunk(
      uploadId,
      index,
      buffer,
    );
    await this.repo.recordChunk({
      sessionId: uploadId,
      index,
      size: buffer.length,
      checksum: actualChecksum,
      filePath,
      storageBackend: ChunkStorageBackend.disk,
    });
    const uploadedBytes = await this.repo.recomputeUploadedBytes(uploadId);

    if (session.status === UploadSessionStatus.pending) {
      await this.repo.updateSessionStatus(
        uploadId,
        UploadSessionStatus.uploading,
      );
    } else {
      await this.repo.updateSessionStatus(uploadId, session.status, {
        uploadedBytes,
      });
    }

    await this.audit.record({
      actorId: ownerId,
      entity: 'resumable_upload',
      entityId: uploadId,
      action: 'chunk_uploaded',
      metadata: {
        index,
        size: buffer.length,
        uploadedBytes,
        totalSize: session.totalSize,
      },
    });

    return this.buildChunkResponse(session, index, true, false, uploadedBytes);
  }

  async getStatus(
    uploadId: string,
    ownerId: string,
  ): Promise<UploadStatusResponse> {
    const session = await this.repo.findSessionByOwner(uploadId, ownerId);
    if (!session) throw new NotFoundException('Upload not found');
    return this.buildStatusResponse(session);
  }

  async listUploads(ownerId: string): Promise<UploadListResponse> {
    const sessions = await this.repo.findSessionsByOwner(ownerId, 100);
    const uploads = sessions.map(s => this.buildStatusResponse(s));
    return { uploads, total: uploads.length };
  }

  async listIncompleteForRecovery(
    ownerId: string,
  ): Promise<UploadStatusResponse[]> {
    const sessions = await this.repo.findIncompleteSessionsByOwner(ownerId);
    return Promise.all(sessions.map(s => this.reconcileAndBuildStatus(s)));
  }

  async resume(
    uploadId: string,
    ownerId: string,
    overrides: { maxAttempts?: number } = {},
  ): Promise<UploadStatusResponse> {
    const session = await this.getOwnedSession(uploadId, ownerId);

    if (session.status === UploadSessionStatus.completed) {
      throw new BadRequestException('Upload already completed');
    }
    if (session.status === UploadSessionStatus.aborted) {
      throw new BadRequestException('Upload has been aborted');
    }
    if (session.expiresAt < new Date()) {
      throw new BadRequestException('Upload session has expired');
    }

    const data: Parameters<typeof this.repo.updateSessionStatus>[2] = {
      lastError: null,
    };
    if (overrides.maxAttempts) {
      data.retryCount = 0;
    }

    const reconciled = await this.reconcileAndBuildStatus(
      await this.repo.updateSessionStatus(
        uploadId,
        UploadSessionStatus.uploading,
        data,
      ),
    );

    await this.audit.record({
      actorId: ownerId,
      entity: 'resumable_upload',
      entityId: uploadId,
      action: 'upload_resumed',
      metadata: {
        receivedChunks: reconciled.receivedChunks.length,
        missingChunks: reconciled.missingChunks.length,
      },
    });

    return reconciled;
  }

  async pause(
    uploadId: string,
    ownerId: string,
  ): Promise<UploadStatusResponse> {
    const session = await this.getOwnedSession(uploadId, ownerId);
    if (
      session.status === UploadSessionStatus.completed ||
      session.status === UploadSessionStatus.aborted
    ) {
      throw new BadRequestException(
        `Cannot pause upload in status ${session.status}`,
      );
    }
    const updated = await this.repo.updateSessionStatus(
      uploadId,
      UploadSessionStatus.paused,
    );
    return this.buildStatusResponse(updated);
  }

  async abort(
    uploadId: string,
    ownerId: string,
  ): Promise<{ ok: true; uploadId: string }> {
    const session = await this.getOwnedSession(uploadId, ownerId);
    if (session.status === UploadSessionStatus.completed) {
      throw new BadRequestException('Cannot abort a completed upload');
    }
    await this.repo.updateSessionStatus(uploadId, UploadSessionStatus.aborted, {
      lastError: 'aborted by user',
    });
    await this.chunkStorage.cleanupSession(uploadId);

    await this.audit.record({
      actorId: ownerId,
      entity: 'resumable_upload',
      entityId: uploadId,
      action: 'upload_aborted',
      metadata: {},
    });

    return { ok: true, uploadId };
  }

  async finalize(
    uploadId: string,
    clientFileChecksum: string,
    ownerId: string,
  ): Promise<FinalizedResponse> {
    const session = await this.getWritableSession(uploadId, ownerId);
    const received = await this.repo.getReceivedChunkIndices(uploadId);

    if (received.length !== session.totalChunks) {
      const missing = Array.from(
        { length: session.totalChunks },
        (_, i) => i,
      ).filter(i => !received.includes(i));
      throw new BadRequestException(`Missing chunks: [${missing.join(', ')}]`);
    }

    const { buffer, checksums, sizes } =
      await this.chunkStorage.assembleAllChunks(uploadId, session.totalChunks);

    if (buffer.length !== session.totalSize) {
      await this.failSession(
        session,
        `final size mismatch: expected ${session.totalSize}, got ${buffer.length}`,
        ownerId,
      );
      throw new BadRequestException(
        `Upload size mismatch: expected ${session.totalSize} bytes, assembled ${buffer.length} bytes`,
      );
    }

    for (let i = 0; i < session.totalChunks; i++) {
      const chunksArr = session.chunks ?? [];
      const dbChunk = chunksArr.find(c => c.index === i);
      if (!dbChunk) continue;
      if (dbChunk.checksum && dbChunk.checksum !== checksums[i]) {
        await this.failSession(
          session,
          `chunk ${i} checksum mismatch on finalization`,
          ownerId,
        );
        throw new BadRequestException(
          `Chunk ${i} integrity check failed during finalization`,
        );
      }
      if (dbChunk.size && dbChunk.size !== sizes[i]) {
        await this.failSession(
          session,
          `chunk ${i} size mismatch on finalization`,
          ownerId,
        );
        throw new BadRequestException(
          `Chunk ${i} size check failed during finalization`,
        );
      }
    }

    const serverFileChecksum = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex');
    if (serverFileChecksum !== clientFileChecksum) {
      await this.failSession(
        session,
        `whole-file checksum mismatch: client=${clientFileChecksum}, server=${serverFileChecksum}`,
        ownerId,
      );
      throw new BadRequestException(
        'Whole-file checksum does not match the uploaded content',
      );
    }

    const duplicate = await this.prisma.evidenceQueueItem.findFirst({
      where: {
        fileHash: serverFileChecksum,
        ...(session.orgId ? { orgId: session.orgId } : {}),
      },
    });
    if (duplicate) {
      await this.repo.updateSessionStatus(
        uploadId,
        UploadSessionStatus.completed,
        {
          uploadedBytes: buffer.length,
          fileChecksum: serverFileChecksum,
          completedAt: new Date(),
        },
      );
      await this.chunkStorage.cleanupSession(uploadId);
      throw new ConflictException('File already exists in evidence queue');
    }

    const encrypted = this.encryption.encryptBuffer(buffer);
    const evidenceFile = path.join(
      this.evidenceDir,
      `${crypto.randomUUID()}.enc`,
    );
    await fs.writeFile(evidenceFile, encrypted);

    const item = await this.prisma.evidenceQueueItem.create({
      data: {
        fileName: session.fileName,
        filePath: evidenceFile,
        fileHash: serverFileChecksum,
        mimeType: session.mimeType,
        size: buffer.length,
        ownerId,
        orgId: session.orgId ?? undefined,
        status: EvidenceStatus.pending,
        metadata: session.metadata ?? undefined,
      },
    });

    await this.repo.updateSessionStatus(
      uploadId,
      UploadSessionStatus.completed,
      {
        uploadedBytes: buffer.length,
        fileChecksum: serverFileChecksum,
        completedAt: new Date(),
        lastError: null,
      },
    );
    await this.chunkStorage.cleanupSession(uploadId);

    await this.audit.record({
      actorId: ownerId,
      entity: 'resumable_upload',
      entityId: uploadId,
      action: 'upload_finalized',
      metadata: {
        evidenceId: item.id,
        fileName: session.fileName,
        fileSize: buffer.length,
        fileChecksum: serverFileChecksum,
      },
    });

    return {
      uploadId,
      evidenceId: item.id,
      fileName: session.fileName,
      fileSize: buffer.length,
      fileChecksum: serverFileChecksum,
      status: 'completed',
    };
  }

  async recoverOnStartup(): Promise<number> {
    const sessions = await this.repo.findAllIncompleteSessions();
    for (const session of sessions) {
      try {
        await this.reconcileAndBuildStatus(session);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to reconcile session ${session.id}: ${message}`,
        );
      }
    }
    return sessions.length;
  }

  async verifyServerSideChunks(
    uploadId: string,
    ownerId: string,
  ): Promise<{
    receivedChunks: number[];
    missingChunks: number[];
    failures: VerificationFailure[];
    uploadedBytes: number;
  }> {
    const session = await this.getOwnedSession(uploadId, ownerId);
    return this.verifyServerSideInternal(session);
  }

  private async verifyServerSideInternal(
    session: SessionWithOptionalChunks,
  ): Promise<{
    receivedChunks: number[];
    missingChunks: number[];
    failures: VerificationFailure[];
    uploadedBytes: number;
  }> {
    const failures: VerificationFailure[] = [];
    const receivedChunks: number[] = [];
    let uploadedBytes = 0;

    const chunks = session.chunks ?? [];
    const chunksByIndex = new Map(chunks.map(c => [c.index, c] as const));

    for (let i = 0; i < session.totalChunks; i++) {
      const dbRow = chunksByIndex.get(i);
      if (!dbRow || !dbRow.uploadedAt || !dbRow.checksum) {
        failures.push({ type: 'missing_chunk', index: i });
        continue;
      }
      const expectedSize =
        i === session.totalChunks - 1
          ? session.totalSize - session.chunkSize * (session.totalChunks - 1)
          : session.chunkSize;
      const verification = await this.chunkStorage.verifyChunkOnDisk(
        session.id,
        i,
        dbRow.checksum,
        expectedSize,
      );
      if (!verification.ok) {
        if (verification.actualSize === 0 && !verification.actualChecksum) {
          failures.push({ type: 'missing_chunk', index: i });
        } else if (verification.actualSize !== expectedSize) {
          failures.push({
            type: 'size_mismatch',
            index: i,
            expected: expectedSize,
            actual: verification.actualSize,
          });
        } else {
          failures.push({
            type: 'checksum_mismatch',
            index: i,
            expected: dbRow.checksum,
            actual: verification.actualChecksum,
          });
        }
        continue;
      }
      receivedChunks.push(i);
      uploadedBytes += verification.actualSize;
    }

    receivedChunks.sort((a, b) => a - b);
    const missingChunks = Array.from(
      { length: session.totalChunks },
      (_, i) => i,
    ).filter(i => !receivedChunks.includes(i));

    return { receivedChunks, missingChunks, failures, uploadedBytes };
  }

  async computeRetryBackoffMs(
    uploadId: string,
    ownerId: string,
  ): Promise<{ attempt: number; backoffMs: number; maxAttempts: number }> {
    const session = await this.getOwnedSession(uploadId, ownerId);
    const attempt = session.retryCount + 1;
    const base = 1000;
    const capped = Math.min(attempt, 8);
    const backoffMs = Math.min(base * Math.pow(2, capped - 1), 60_000);
    return { attempt, backoffMs, maxAttempts: session.maxAttempts };
  }

  async recordRetryFailure(
    uploadId: string,
    ownerId: string,
    errorMessage: string,
  ): Promise<UploadStatusResponse> {
    const session = await this.getOwnedSession(uploadId, ownerId);
    const next = await this.repo.incrementSessionRetry(uploadId, errorMessage);
    if (next.retryCount >= session.maxAttempts) {
      const failed = await this.repo.updateSessionStatus(
        uploadId,
        UploadSessionStatus.failed,
        {
          failedAt: new Date(),
          lastError: errorMessage,
          retryCount: next.retryCount,
        },
      );
      return this.buildStatusResponse(failed);
    }
    return this.buildStatusResponse(next);
  }

  // ── private helpers ────────────────────────────────────────────────────

  private async getOwnedSession(
    uploadId: string,
    ownerId: string,
  ): Promise<SessionWithRequiredChunks> {
    const session = await this.repo.findSessionByOwner(uploadId, ownerId);
    if (!session) throw new NotFoundException('Upload not found');
    return session;
  }

  private async getWritableSession(
    uploadId: string,
    ownerId: string,
  ): Promise<SessionWithRequiredChunks> {
    const session = await this.getOwnedSession(uploadId, ownerId);
    if (session.expiresAt < new Date()) {
      await this.repo.updateSessionStatus(
        uploadId,
        UploadSessionStatus.expired,
      );
      throw new BadRequestException('Upload session has expired');
    }
    const nonWritable: UploadSessionStatus[] = [
      UploadSessionStatus.completed,
      UploadSessionStatus.aborted,
      UploadSessionStatus.expired,
    ];
    if (nonWritable.includes(session.status)) {
      throw new BadRequestException(
        `Upload session is not writable (status=${session.status})`,
      );
    }
    return session;
  }

  private async failSession(
    session: UploadSession,
    reason: string,
    ownerId: string,
  ): Promise<void> {
    try {
      await this.repo.updateSessionStatus(
        session.id,
        UploadSessionStatus.failed,
        {
          failedAt: new Date(),
          lastError: reason,
        },
      );
      await this.audit.record({
        actorId: ownerId,
        entity: 'resumable_upload',
        entityId: session.id,
        action: 'upload_failed',
        metadata: { reason },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to mark session ${session.id} as failed: ${message}`,
      );
      throw new InternalServerErrorException(
        'Integrity check failed; state update also failed',
      );
    }
  }

  private buildChunkResponse(
    session: UploadSession,
    index: number,
    received: boolean,
    duplicate: boolean,
    uploadedBytesOverride?: number,
  ): ChunkReceivedResponse {
    const uploadedBytes = uploadedBytesOverride ?? session.uploadedBytes;
    const progressPercent = session.totalSize
      ? Math.min(
          100,
          Math.round((uploadedBytes / session.totalSize) * 10000) / 100,
        )
      : 0;
    return {
      uploadId: session.id,
      index,
      received,
      duplicate,
      uploadedBytes,
      progressPercent,
    };
  }

  private async reconcileAndBuildStatus(
    session: SessionWithOptionalChunks,
  ): Promise<UploadStatusResponse> {
    const verified = await this.verifyServerSideInternal(session);
    if (verified.uploadedBytes !== session.uploadedBytes) {
      await this.repo.updateSessionStatus(session.id, session.status, {
        uploadedBytes: verified.uploadedBytes,
      });
    }
    const failuresPresent = verified.failures.length > 0;
    if (failuresPresent && session.status === UploadSessionStatus.uploading) {
      await this.repo.updateSessionStatus(
        session.id,
        UploadSessionStatus.paused,
        {
          lastError:
            verified.failures[0]?.type === 'missing_chunk'
              ? `missing chunk(s) on disk; need re-upload`
              : 'integrity verification failed on resume; re-upload required',
          uploadedBytes: verified.uploadedBytes,
        },
      );
    }
    return this.buildStatusResponse(session, verified);
  }

  private buildStatusResponse(
    session: SessionWithOptionalChunks,
    verified?: Awaited<ReturnType<typeof this.verifyServerSideInternal>>,
  ): UploadStatusResponse {
    const chunks = session.chunks ?? [];
    let receivedChunks: number[];
    let missingChunks: number[];
    let uploadedBytes = session.uploadedBytes;

    if (verified) {
      receivedChunks = verified.receivedChunks;
      missingChunks = verified.missingChunks;
      uploadedBytes = verified.uploadedBytes;
    } else {
      receivedChunks = chunks
        .filter(c => c.uploadedAt)
        .map(c => c.index)
        .sort((a, b) => a - b);
      missingChunks = Array.from(
        { length: session.totalChunks },
        (_, i) => i,
      ).filter(i => !receivedChunks.includes(i));
    }

    const progressPercent = session.totalSize
      ? Math.min(
          100,
          Math.round((uploadedBytes / session.totalSize) * 10000) / 100,
        )
      : 0;

    const chunksMeta: UploadChunkMeta[] = Array.from(
      { length: session.totalChunks },
      (_, i) => {
        const row = chunks.find(c => c.index === i);
        return {
          index: i,
          size: row?.size ?? 0,
          checksum: row?.checksum ?? '',
          uploadedAt: row?.uploadedAt ?? null,
          attemptCount: row?.attemptCount ?? 0,
          lastError: row?.lastError ?? null,
        };
      },
    );

    return {
      uploadId: session.id,
      fileName: session.fileName,
      fileSize: session.totalSize,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedBytes,
      progressPercent,
      status: session.status,
      receivedChunks,
      missingChunks,
      chunks: chunksMeta,
      retryCount: session.retryCount,
      lastError: session.lastError,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt ?? null,
    };
  }
}
