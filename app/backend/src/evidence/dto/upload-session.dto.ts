import { IsString, IsNumber, IsPositive, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUploadSessionDto {
  @ApiProperty({
    description: 'Original file name',
    example: 'evidence_document.pdf',
  })
  @IsString()
  fileName: string;

  @ApiProperty({
    description: 'MIME type of the file',
    example: 'application/pdf',
  })
  @IsString()
  mimeType: string;

  @ApiProperty({
    description: 'Total file size in bytes',
    example: 10485760,
  })
  @IsNumber()
  @IsPositive()
  totalSize: number;

  @ApiProperty({
    description: 'Size of each chunk in bytes (default: 5MB)',
    example: 5242880,
    required: false,
  })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  chunkSize?: number;

  @ApiPropertyOptional({
    description: 'Optional metadata (e.g., associated claimId)',
    example: { claimId: 'claim_123' },
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class UploadChunkDto {
  @ApiProperty({
    description: 'Chunk index (0-based)',
    example: 0,
  })
  @IsNumber()
  @Min(0)
  chunkIndex: number;

  @ApiProperty({
    description: 'Total number of chunks',
    example: 5,
  })
  @IsNumber()
  @IsPositive()
  totalChunks: number;

  @ApiProperty({
    description: 'Hash of the chunk data for verification',
    example: 'abc123def456...',
  })
  @IsString()
  chunkHash: string;
}

export class FinalizeUploadSessionDto {
  @ApiProperty({
    description: 'Hash of the complete assembled file',
    example: 'sha256_hash_of_complete_file',
  })
  @IsString()
  fileHash: string;

  @ApiPropertyOptional({
    description: 'Optional metadata to associate with the finalized upload',
    example: { claimId: 'claim_123', category: 'identity' },
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class UploadSessionResponseDto {
  @ApiProperty({ description: 'Session ID' })
  sessionId: string;

  @ApiProperty({ description: 'File name' })
  fileName: string;

  @ApiProperty({ description: 'MIME type' })
  mimeType: string;

  @ApiProperty({ description: 'Total file size in bytes' })
  totalSize: number;

  @ApiProperty({ description: 'Chunk size in bytes' })
  chunkSize: number;

  @ApiProperty({ description: 'Total number of chunks' })
  totalChunks: number;

  @ApiProperty({ description: 'Number of chunks uploaded so far' })
  uploadedChunks: number;

  @ApiProperty({ description: 'Session status' })
  status: string;

  @ApiProperty({ description: 'Session expiry timestamp' })
  expiresAt: Date;

  @ApiProperty({ description: 'Created timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'List of uploaded chunk indices', required: false })
  uploadedChunkIndices?: number[];
}
