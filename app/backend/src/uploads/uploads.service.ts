import {
  Injectable,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { UploadSessionStatus } from '@prisma/client';

@Injectable()
export class UploadsService {
  constructor(private prisma: PrismaService) {}

  async createSession(dto: CreateUploadSessionDto) {
    // Validate content type
    const validContentTypes = [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!validContentTypes.includes(dto.contentType)) {
      throw new BadRequestException(
        'Invalid content type. Only images and documents are allowed.',
      );
    }

    // Validate size limit
    if (dto.totalSize > 50 * 1024 * 1024) {
      // 50MB
      throw new PayloadTooLargeException('File size exceeds 50MB limit');
    }

    // Set expiry
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    return this.prisma.uploadSession.create({
      data: {
        ownerId: dto.ownerId,
        filename: dto.filename,
        contentType: dto.contentType,
        totalSize: dto.totalSize,
        status: UploadSessionStatus.pending,
        expiresAt,
      },
    });
  }

  async uploadChunk(
    sessionId: string,
    chunkIndex: number,
    size: number,
    _buffer: Buffer,
  ) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    if (session.status !== UploadSessionStatus.pending) {
      throw new BadRequestException(
        `Cannot upload chunk to session with status ${session.status}`,
      );
    }

    if (session.expiresAt < new Date()) {
      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: UploadSessionStatus.expired },
      });
      throw new BadRequestException('Upload session expired');
    }

    // Here we would typically stream the buffer to S3, GCS, or a local file system.
    // For now, we simulate the storage and just track the chunk completion in the DB.

    // Check if chunk already exists for idempotency (resume semantics)
    const existingChunk = await this.prisma.uploadChunk.findUnique({
      where: {
        uploadSessionId_chunkIndex: {
          uploadSessionId: sessionId,
          chunkIndex,
        },
      },
    });

    if (existingChunk) {
      return existingChunk;
    }

    return this.prisma.uploadChunk.create({
      data: {
        uploadSessionId: sessionId,
        chunkIndex,
        size,
      },
    });
  }

  async finalizeSession(sessionId: string, ownerId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
      include: { chunks: true },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    // Validate ownership
    if (session.ownerId !== ownerId) {
      throw new BadRequestException('Ownership validation failed');
    }

    if (session.status !== UploadSessionStatus.pending) {
      throw new BadRequestException(
        `Cannot finalize session with status ${session.status}`,
      );
    }

    const uploadedSize = session.chunks.reduce(
      (acc, chunk) => acc + chunk.size,
      0,
    );
    if (uploadedSize !== session.totalSize) {
      throw new BadRequestException(
        `Size mismatch: expected ${session.totalSize}, got ${uploadedSize}`,
      );
    }

    // Check chunk ordering (make sure all chunks are present and contiguous)
    const sortedChunks = session.chunks.sort(
      (a, b) => a.chunkIndex - b.chunkIndex,
    );
    for (let i = 0; i < sortedChunks.length; i++) {
      if (sortedChunks[i].chunkIndex !== i) {
        throw new BadRequestException(`Missing chunk at index ${i}`);
      }
    }

    // Transition state
    return this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.completed },
    });
  }
}
