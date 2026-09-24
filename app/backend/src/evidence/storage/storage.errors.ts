/**
 * Typed errors for storage operations.
 *
 * Replacing the previous silent-success mock, every storage failure now
 * surfaces as one of these so callers (e.g. EvidenceService) can record a
 * real failure instead of marking an upload "completed" when nothing was
 * actually stored.
 */
export class StorageError extends Error {
  /** The underlying driver/cause, when available. */
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
    // Restore prototype chain for instanceof checks under transpilation.
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

export class StorageUploadError extends StorageError {
  public readonly key: string;

  constructor(key: string, cause?: unknown) {
    super(`Failed to store evidence with key "${key}".`, cause);
    this.name = 'StorageUploadError';
    this.key = key;
    Object.setPrototypeOf(this, StorageUploadError.prototype);
  }
}

export class StorageDownloadError extends StorageError {
  public readonly key: string;

  constructor(key: string, cause?: unknown) {
    super(`Failed to retrieve evidence with key "${key}".`, cause);
    this.name = 'StorageDownloadError';
    this.key = key;
    Object.setPrototypeOf(this, StorageDownloadError.prototype);
  }
}

export class StorageDeleteError extends StorageError {
  public readonly key: string;

  constructor(key: string, cause?: unknown) {
    super(`Failed to delete evidence with key "${key}".`, cause);
    this.name = 'StorageDeleteError';
    this.key = key;
    Object.setPrototypeOf(this, StorageDeleteError.prototype);
  }
}

export class StorageConfigError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'StorageConfigError';
    Object.setPrototypeOf(this, StorageConfigError.prototype);
  }
}
