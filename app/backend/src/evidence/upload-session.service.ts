import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateUploadSessionDto,
  UploadChunkDto,
  FinalizeUploadSessionDto,
  UploadSessionResponseDto,
} from './dto/upload-session.dto';
import { UploadSessionStatus, EvidenceStatus } from '@prisma/client';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class UploadSessionService {
  private readonly logger = new Logger(UploadSessionService.name);
  private readonly chunkUploadDir = path.join(
    process.cwd(),
    'uploads',
    'chunks',
  );
  private readonly assembledDir = path.join(
    process.cwd(),
    'uploads',
    'assembled',
  );

  // Configuration constants
  private readonly DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private readonly SESSION_EXPIRY_HOURS = 24;
  private readonly ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'video/mp4',
    'video/quicktime',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
  ) {
    // Ensure upload directories exist
    if (!existsSync(this.chunkUploadDir)) {
      mkdirSync(this.chunkUploadDir, { recursive: true });
    }
    if (!existsSync(this.assembledDir)) {
      mkdirSync(this.assembledDir, { recursive: true });
    }
  }

  /**
   * Create a new upload session
   */
  async createSession(
    dto: CreateUploadSessionDto,
    ownerId: string,
  ): Promise<UploadSessionResponseDto> {
    // Validate file size
    if (dto.totalSize > this.MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${this.MAX_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }

    // Validate content type
    if (!this.ALLOWED_MIME_TYPES.includes(dto.mimeType)) {
      throw new BadRequestException(
        `File type ${dto.mimeType} is not allowed. Allowed types: ${this.ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    const chunkSize = dto.chunkSize || this.DEFAULT_CHUNK_SIZE;
    const totalChunks = Math.ceil(dto.totalSize / chunkSize);

    // Create session directory
    const sessionId = crypto.randomUUID();
    const sessionDir = path.join(this.chunkUploadDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.SESSION_EXPIRY_HOURS);

    const session = await this.prisma.uploadSession.create({
      data: {
        id: sessionId,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        totalSize: dto.totalSize,
        chunkSize,
        totalChunks,
        ownerId,
        uploadDir: sessionDir,
        expiresAt,
        status: UploadSessionStatus.created,
      },
    });

    await this.auditService.record({
      actorId: ownerId,
      entity: 'upload_session',
      entityId: session.id,
      action: 'create_session',
      metadata: {
        fileName: dto.fileName,
        totalSize: dto.totalSize,
        totalChunks,
      },
    });

    return this.mapSessionToResponse(session);
  }

  /**
   * Upload a chunk to an existing session
   */
  async uploadChunk(
    sessionId: string,
    chunkDto: UploadChunkDto,
    chunkData: Buffer,
    ownerId: string,
  ): Promise<UploadSessionResponseDto> {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: sessionId,
        ownerId,
      },
      include: {
        chunks: {
          select: {
            chunkIndex: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    // Check session status
    if (session.status === UploadSessionStatus.expired) {
      throw new BadRequestException('Upload session has expired');
    }

    if (session.status === UploadSessionStatus.completed) {
      throw new ConflictException('Upload session already completed');
    }

    if (session.status === UploadSessionStatus.cancelled) {
      throw new BadRequestException('Upload session was cancelled');
    }

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: UploadSessionStatus.expired },
      });
      throw new BadRequestException('Upload session has expired');
    }

    // Validate chunk index
    if (chunkDto.chunkIndex < 0 || chunkDto.chunkIndex >= session.totalChunks) {
      throw new BadRequestException('Invalid chunk index');
    }

    // Validate total chunks matches
    if (chunkDto.totalChunks !== session.totalChunks) {
      throw new BadRequestException('Total chunks mismatch');
    }

    // Verify chunk hash
    const actualHash = crypto.createHash('sha256').update(chunkData).digest('hex');
    if (actualHash !== chunkDto.chunkHash) {
      throw new BadRequestException('Chunk hash verification failed');
    }

    // Check if chunk already exists
    const existingChunk = await this.prisma.uploadChunk.findFirst({
      where: {
        sessionId,
        chunkIndex: chunkDto.chunkIndex,
      },
    });

    if (existingChunk) {
      // Chunk already uploaded, return current session state
      this.logger.log(`Chunk ${chunkDto.chunkIndex} already uploaded for session ${sessionId}`);
      return this.mapSessionToResponse(session);
    }

    // Save chunk to disk
    const chunkFileName = `chunk_${chunkDto.chunkIndex}.bin`;
    const chunkFilePath = path.join(session.uploadDir!, chunkFileName);
    await fs.writeFile(chunkFilePath, chunkData);

    // Create chunk record in database
    await this.prisma.uploadChunk.create({
      data: {
        sessionId,
        chunkIndex: chunkDto.chunkIndex,
        chunkHash: chunkDto.chunkHash,
        filePath: chunkFilePath,
        size: chunkData.length,
      },
    });

    // Update session
    const updatedSession = await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: {
        uploadedChunks: { increment: 1 },
        status: UploadSessionStatus.uploading,
        updatedAt: new Date(),
      },
      include: {
        chunks: {
          select: {
            chunkIndex: true,
          },
        },
      },
    });

    await this.auditService.record({
      actorId: ownerId,
      entity: 'upload_session',
      entityId: sessionId,
      action: 'upload_chunk',
      metadata: {
        chunkIndex: chunkDto.chunkIndex,
        chunkSize: chunkData.length,
        uploadedChunks: updatedSession.uploadedChunks,
      },
    });

    return this.mapSessionToResponse(updatedSession);
  }

  /**
   * Finalize an upload session by assembling all chunks
   */
  async finalizeSession(
    sessionId: string,
    dto: FinalizeUploadSessionDto,
    ownerId: string,
  ): Promise<UploadSessionResponseDto> {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: sessionId,
        ownerId,
      },
      include: {
        chunks: {
          orderBy: {
            chunkIndex: 'asc',
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    // Validate session state
    if (session.status === UploadSessionStatus.completed) {
      throw new ConflictException('Upload session already completed');
    }

    if (session.status === UploadSessionStatus.expired) {
      throw new BadRequestException('Upload session has expired');
    }

    // Check if all chunks are uploaded
    if (session.uploadedChunks !== session.totalChunks) {
      throw new BadRequestException(
        `Not all chunks uploaded. Uploaded: ${session.uploadedChunks}, Total: ${session.totalChunks}`,
      );
    }

    // Assemble chunks in order
    const assembledFileName = `${crypto.randomUUID()}.enc`;
    const assembledFilePath = path.join(this.assembledDir, assembledFileName);

    try {
      // Read and decrypt all chunks, then re-encrypt the complete file
      const assembledBuffer = Buffer.alloc(session.totalSize);
      let offset = 0;

      for (const chunk of session.chunks) {
        const chunkBuffer = await fs.readFile(chunk.filePath);
        chunkBuffer.copy(assembledBuffer, offset);
        offset += chunkBuffer.length;
      }

      // Verify assembled file hash
      const assembledHash = crypto
        .createHash('sha256')
        .update(assembledBuffer)
        .digest('hex');

      if (assembledHash !== dto.fileHash) {
        throw new BadRequestException('Assembled file hash verification failed');
      }

      // Encrypt the complete file
      const encryptedBuffer = this.encryptionService.encryptBuffer(assembledBuffer);
      await fs.writeFile(assembledFilePath, encryptedBuffer);

      // Update session status
      const updatedSession = await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: {
          status: UploadSessionStatus.completed,
          finalFilePath: assembledFilePath,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
        include: {
          chunks: {
            select: {
              chunkIndex: true,
            },
          },
        },
      });

      // Create evidence queue item for processing
      await this.prisma.evidenceQueueItem.create({
        data: {
          fileName: session.fileName,
          filePath: assembledFilePath,
          fileHash: dto.fileHash,
          mimeType: session.mimeType,
          size: session.totalSize,
          ownerId,
          status: EvidenceStatus.pending,
          metadata: dto.metadata || {},
        },
      });

      await this.auditService.record({
        actorId: ownerId,
        entity: 'upload_session',
        entityId: sessionId,
        action: 'finalize_session',
        metadata: {
          fileName: session.fileName,
          totalSize: session.totalSize,
          fileHash: dto.fileHash,
        },
      });

      // Clean up chunk files
      await this.cleanupChunks(session.uploadDir!);

      return this.mapSessionToResponse(updatedSession);
    } catch (error) {
      this.logger.error(
        `Failed to finalize session ${sessionId}: ${(error as Error).message}`,
      );

      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: {
          status: UploadSessionStatus.failed,
          updatedAt: new Date(),
        },
      });

      throw error;
    }
  }

  /**
   * Get session status
   */
  async getSessionStatus(
    sessionId: string,
    ownerId: string,
  ): Promise<UploadSessionResponseDto> {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: sessionId,
        ownerId,
      },
      include: {
        chunks: {
          select: {
            chunkIndex: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    // Check if session has expired
    if (
      session.status !== UploadSessionStatus.completed &&
      session.status !== UploadSessionStatus.cancelled &&
      new Date() > session.expiresAt
    ) {
      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: UploadSessionStatus.expired },
      });
      session.status = UploadSessionStatus.expired;
    }

    return this.mapSessionToResponse(session);
  }

  /**
   * Cancel an upload session
   */
  async cancelSession(
    sessionId: string,
    ownerId: string,
  ): Promise<{ message: string }> {
    const session = await this.prisma.uploadSession.findFirst({
      where: {
        id: sessionId,
        ownerId,
      },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    if (session.status === UploadSessionStatus.completed) {
      throw new ConflictException('Cannot cancel a completed session');
    }

    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: {
        status: UploadSessionStatus.cancelled,
        updatedAt: new Date(),
      },
    });

    // Clean up chunk files
    if (session.uploadDir) {
      await this.cleanupChunks(session.uploadDir);
    }

    await this.auditService.record({
      actorId: ownerId,
      entity: 'upload_session',
      entityId: sessionId,
      action: 'cancel_session',
      metadata: { fileName: session.fileName },
    });

    return { message: 'Upload session cancelled' };
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const expiredSessions = await this.prisma.uploadSession.findMany({
      where: {
        status: {
          in: [UploadSessionStatus.created, UploadSessionStatus.uploading],
        },
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    let cleanedCount = 0;

    for (const session of expiredSessions) {
      try {
        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: { status: UploadSessionStatus.expired },
        });

        if (session.uploadDir) {
          await this.cleanupChunks(session.uploadDir);
        }

        cleanedCount++;
      } catch (error) {
        this.logger.error(
          `Failed to cleanup session ${session.id}: ${(error as Error).message}`,
        );
      }
    }

    return cleanedCount;
  }

  /**
   * Helper: Map session entity to response DTO
   */
  private mapSessionToResponse(session: any): UploadSessionResponseDto {
    return {
      sessionId: session.id,
      fileName: session.fileName,
      mimeType: session.mimeType,
      totalSize: session.totalSize,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedChunks: session.uploadedChunks,
      status: session.status,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      uploadedChunkIndices: session.chunks?.map((c: any) => c.chunkIndex) || [],
    };
  }

  /**
   * Helper: Clean up chunk directory
   */
  private async cleanupChunks(dirPath: string): Promise<void> {
    try {
      if (existsSync(dirPath)) {
        await fs.rm(dirPath, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to cleanup chunks directory ${dirPath}: ${(error as Error).message}`,
      );
    }
  }
}
