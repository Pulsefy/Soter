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

/**
 * In-memory storage driver used exclusively for tests.
 *
 * It is intentionally excluded from the default driver selection: the app
 * fails fast at startup unless `STORAGE_DRIVER` is explicitly `mock`. Never
 * use this in a real deployment — nothing stored here survives a restart.
 */
export class MockStorageDriver implements StorageDriver {
  readonly type: StorageDriverType = 'mock';
  private readonly store = new Map<string, Buffer>();

  async upload(key: string, data: Buffer): Promise<StorageUploadResult> {
    await Promise.resolve();
    if (!Buffer.isBuffer(data)) {
      throw new StorageUploadError(key, 'data must be a Buffer');
    }
    this.store.set(key, Buffer.from(data));
    return { key };
  }

  async download(key: string): Promise<Buffer> {
    await Promise.resolve();
    const data = this.store.get(key);
    if (!data) {
      throw new StorageDownloadError(key, 'No such object in mock store');
    }
    return Buffer.from(data);
  }

  async remove(key: string): Promise<void> {
    await Promise.resolve();
    if (!this.store.delete(key)) {
      throw new StorageDeleteError(key, 'No such object in mock store');
    }
  }

  async exists(key: string): Promise<boolean> {
    await Promise.resolve();
    return this.store.has(key);
  }

  /** Test helper: wipe all stored objects. */
  reset(): void {
    this.store.clear();
  }
}
