import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { STORAGE_CONFIG, STORAGE_DRIVER } from './storage.factory';
import { StorageConfig } from './storage.config';
import { StorageDriver, StorageDriverType } from './storage-driver.interface';
import {
  StorageDeleteError,
  StorageDownloadError,
  StorageError,
  StorageUploadError,
} from './storage.errors';

/**
 * Application-facing facade over the configured {@link StorageDriver}.
 *
 * Evidence arrives already encrypted from {@link EncryptionService}; this
 * service only persists/retrieves opaque bytes and guarantees that failures
 * surface as typed {@link StorageError}s. It also owns storage-key generation
 * so every backend produces a consistent, namespaced, retrievable key.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
  ) {}

  get driverType(): StorageDriverType {
    return this.driver.type;
  }

  /**
   * Build a storage key for an evidence artifact.
   *
   * Keys are namespaced by organization (or `global`) so different tenants
   * cannot collide, and end in a UUID for uniqueness. The returned value is
   * what {@link upload} expects and what later fetches must present.
   */
  generateKey(orgId?: string | null): string {
    const scope = orgId ? `org-${orgId}` : 'global';
    return `evidence/${scope}/${randomUUID()}.enc`;
  }

  /** Store `data` under `key`. Resolves with the retrievable key or throws. */
  async upload(key: string, data: Buffer): Promise<string> {
    try {
      const result = await this.driver.upload(key, data);
      this.logger.log(
        `Stored evidence under key "${result.key}" (${this.driver.type})`,
      );
      return result.key;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageUploadError(key, err);
    }
  }

  /** Retrieve bytes stored under `key`. */
  async download(key: string): Promise<Buffer> {
    try {
      return await this.driver.download(key);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageDownloadError(key, err);
    }
  }

  /** Delete the object stored under `key`. */
  async remove(key: string): Promise<void> {
    try {
      await this.driver.remove(key);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageDeleteError(key, err);
    }
  }

  /** Whether an object exists under `key`. */
  async exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }
}
