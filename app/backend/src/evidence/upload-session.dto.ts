import { IsInt, IsString, Min, Max, IsIn } from 'class-validator';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from './file-validation';

const MAX_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk
const MIN_CHUNK_SIZE = 64 * 1024; // 64 KB minimum

export class CreateUploadSessionDto {
  @IsString()
  fileName: string;

  @IsIn(ALLOWED_MIME_TYPES as unknown as string[])
  mimeType: string;

  /** Total file size in bytes. */
  @IsInt()
  @Min(1)
  @Max(MAX_FILE_SIZE)
  totalSize: number;

  /** Size of each chunk in bytes (last chunk may be smaller). */
  @IsInt()
  @Min(MIN_CHUNK_SIZE)
  @Max(MAX_CHUNK_SIZE)
  chunkSize: number;
}

export class UploadChunkDto {
  /** Zero-based chunk index. */
  @IsInt()
  @Min(0)
  index: number;

  /** SHA-256 hex checksum of this chunk's raw bytes. */
  @IsString()
  checksum: string;
}
