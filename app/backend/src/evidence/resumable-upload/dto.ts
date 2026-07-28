import {
  IsInt,
  IsString,
  Min,
  Max,
  IsIn,
  IsOptional,
  IsNotEmpty,
} from 'class-validator';
import type { UploadSessionStatus } from '@prisma/client';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '../file-validation';

export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const MIN_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = DEFAULT_CHUNK_SIZE;
const DEFAULT_MAX_ATTEMPTS = 5;

export class CreateResumableUploadDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsIn(ALLOWED_MIME_TYPES as unknown as string[])
  mimeType: string;

  @IsInt()
  @Min(1)
  @Max(MAX_FILE_SIZE)
  fileSize: number;

  @IsInt()
  @Min(MIN_CHUNK_SIZE)
  @Max(MAX_CHUNK_SIZE)
  @IsOptional()
  chunkSize: number = DEFAULT_CHUNK_SIZE;

  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS;

  @IsString()
  @IsOptional()
  claimId?: string;
}

export class UploadChunkDto {
  @IsInt()
  @Min(0)
  index: number;

  @IsString()
  @IsNotEmpty()
  checksum: string;
}

export class FinalizeUploadDto {
  @IsString()
  @IsNotEmpty()
  fileChecksum: string;
}

export class ResumeUploadDto {
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  maxAttempts?: number;
}

export interface UploadChunkMeta {
  index: number;
  size: number;
  checksum: string;
  uploadedAt: Date | null;
  attemptCount: number;
  lastError: string | null;
}

export interface UploadStatusResponse {
  uploadId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  uploadedBytes: number;
  progressPercent: number;
  status: UploadSessionStatus;
  receivedChunks: number[];
  missingChunks: number[];
  chunks: UploadChunkMeta[];
  retryCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface UploadListResponse {
  uploads: UploadStatusResponse[];
  total: number;
}

export interface UploadCreatedResponse {
  uploadId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  status: UploadSessionStatus;
  expiresAt: Date;
}

export interface ChunkReceivedResponse {
  uploadId: string;
  index: number;
  received: boolean;
  duplicate: boolean;
  uploadedBytes: number;
  progressPercent: number;
}

export interface FinalizedResponse {
  uploadId: string;
  evidenceId: string;
  fileName: string;
  fileSize: number;
  fileChecksum: string;
  status: 'completed';
}
