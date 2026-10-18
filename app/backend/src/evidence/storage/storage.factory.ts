import { StorageConfig } from './storage.config';
import { StorageDriver } from './storage-driver.interface';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { MockStorageDriver } from './mock-storage.driver';
import { StorageConfigError } from './storage.errors';

/** DI token for the resolved {@link StorageConfig}. */
export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');
/** DI token for the selected {@link StorageDriver}. */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/**
 * Build a concrete {@link StorageDriver} from a validated {@link StorageConfig}.
 * Centralizes construction so the module and tests share one selection path.
 */
export function createStorageDriver(config: StorageConfig): StorageDriver {
  switch (config.driver) {
    case 'local':
      if (!config.local) {
        throw new StorageConfigError('Local storage config missing baseDir');
      }
      return new LocalStorageDriver({ baseDir: config.local.baseDir });
    case 's3':
      if (!config.s3) {
        throw new StorageConfigError('S3 storage config missing bucket/region');
      }
      return new S3StorageDriver({
        bucket: config.s3.bucket,
        region: config.s3.region,
        endpoint: config.s3.endpoint,
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
        forcePathStyle: config.s3.forcePathStyle,
      });
    case 'mock':
      return new MockStorageDriver();
    default:
      throw new StorageConfigError(
        `Unsupported storage driver: ${String(config.driver)}`,
      );
  }
}
