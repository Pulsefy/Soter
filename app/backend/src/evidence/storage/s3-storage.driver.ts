import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  StorageDriver,
  StorageDriverType,
  StorageUploadResult,
} from './storage-driver.interface';
import {
  StorageDeleteError,
  StorageDownloadError,
  StorageUploadError,
} from './storage.errors';

export interface S3StorageOptions {
  /** Target bucket name. */
  bucket: string;
  /** AWS region (or region-less for MinIO, where `endpoint` is set). */
  region: string;
  /** Optional custom endpoint (e.g. MinIO: http://localhost:9000). */
  endpoint?: string;
  /** Access key. When omitted, the SDK falls back to its default credential chain. */
  accessKeyId?: string;
  /** Secret key. */
  secretAccessKey?: string;
  /**
   * Force path-style addressing. Required for MinIO and most
   * S3-compatible servers; auto-enabled when a custom `endpoint` is supplied.
   */
  forcePathStyle?: boolean;
}

/**
 * S3-compatible storage driver (AWS S3, MinIO, Ceph, GCS Interoperability API).
 *
 * The same code path serves both production S3 and a local MinIO instance; the
 * only difference is the configuration. Use MinIO locally by setting
 * `STORAGE_S3_ENDPOINT` to your MinIO URL and `STORAGE_S3_FORCE_PATH_STYLE=true`.
 */
export class S3StorageDriver implements StorageDriver {
  readonly type: StorageDriverType = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle:
        options.forcePathStyle ?? (options.endpoint ? true : false),
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            }
          : undefined,
    });
  }

  async upload(key: string, data: Buffer): Promise<StorageUploadResult> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
        }),
      );
    } catch (err) {
      throw new StorageUploadError(key, err);
    }
    return { key };
  }

  async download(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes) {
        throw new StorageDownloadError(key, 'Empty object body');
      }
      return Buffer.from(bytes);
    } catch (err) {
      throw new StorageDownloadError(key, err);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err) {
      throw new StorageDeleteError(key, err);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (httpStatus === 404) return false;
      throw new StorageDownloadError(key, err);
    }
  }
}
