import { promises as fs } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';

import {
  StorageDriver,
  StorageDriverType,
  StorageUploadResult,
} from './storage-driver.interface';
import {
  StorageDeleteError,
  StorageDownloadError,
  StorageError,
  StorageUploadError,
} from './storage.errors';

export interface LocalStorageOptions {
  /** Directory under which all objects are stored. Resolved to an absolute path. */
  baseDir: string;
}

/**
 * Filesystem-backed storage driver.
 *
 * Objects are written under `baseDir` using the (sanitized) storage key as a
 * relative path, which makes this a natural local development backend and also
 * a stand-in for MinIO/S3-style stores when deployed against a mounted volume.
 * Path traversal is rejected so a caller-supplied key can never escape
 * `baseDir`.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly type: StorageDriverType = 'local';
  private readonly baseDir: string;

  constructor(options: LocalStorageOptions) {
    this.baseDir = path.resolve(options.baseDir);
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolve(key: string): string {
    const full = path.resolve(this.baseDir, key);
    const relative = path.relative(this.baseDir, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new StorageError(
        `Refusing to write outside the storage root: "${key}"`,
      );
    }
    return full;
  }

  async upload(key: string, data: Buffer): Promise<StorageUploadResult> {
    const full = this.resolve(key);
    try {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, data);
    } catch (err) {
      throw new StorageUploadError(key, err);
    }
    return { key };
  }

  async download(key: string): Promise<Buffer> {
    const full = this.resolve(key);
    try {
      return await fs.readFile(full);
    } catch (err) {
      throw new StorageDownloadError(key, err);
    }
  }

  async remove(key: string): Promise<void> {
    const full = this.resolve(key);
    try {
      await fs.unlink(full);
    } catch (err) {
      // A missing file on delete is treated as success (idempotent cleanup).
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new StorageDeleteError(key, err);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
