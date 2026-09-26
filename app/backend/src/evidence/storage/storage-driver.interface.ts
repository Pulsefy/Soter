/**
 * Pluggable object storage abstraction for durable evidence artifacts.
 *
 * Evidence is encrypted before it ever reaches a StorageDriver, so drivers only
 * ever see opaque ciphertext. Implementations must guarantee that whatever
 * `upload()` returns in {@link StorageUploadResult.key} can later be handed to
 * `download()`/`remove()` to retrieve or delete the exact bytes that were
 * stored. A failed `upload()` must reject with a typed {@link StorageError}
 * rather than resolving to a silent success.
 */
export type StorageDriverType = 'local' | 's3' | 'mock';

/** Result of a successful upload. `key` is the retrievable handle. */
export interface StorageUploadResult {
  /** Opaque key used to fetch or delete the stored object later. */
  key: string;
}

/**
 * Contract every storage backend must satisfy.
 *
 * All methods reject with a {@link StorageError} (or subclass) on failure.
 */
export interface StorageDriver {
  /** Identifier of the selected backend (`local` | `s3` | `mock`). */
  readonly type: StorageDriverType;

  /**
   * Persist `data` under `key`. Resolves with the retrievable key on success.
   * Must never resolve on failure — it throws a typed {@link StorageError}.
   */
  upload(key: string, data: Buffer): Promise<StorageUploadResult>;

  /**
   * Retrieve the bytes previously stored under `key`.
   * Throws {@link StorageError} if the object cannot be read.
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete the object stored under `key`.
   * Throws {@link StorageError} if the delete fails.
   */
  remove(key: string): Promise<void>;

  /**
   * Whether an object exists under `key`.
   */
  exists(key: string): Promise<boolean>;
}
