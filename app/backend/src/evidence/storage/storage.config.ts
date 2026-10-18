import { StorageDriverType } from './storage-driver.interface';

/** Env var that selects the storage backend. */
export const STORAGE_DRIVER_ENV = 'STORAGE_DRIVER';

/** Env vars for the S3-compatible backend. */
export const STORAGE_S3_BUCKET_ENV = 'STORAGE_S3_BUCKET';
export const STORAGE_S3_REGION_ENV = 'STORAGE_S3_REGION';
export const STORAGE_S3_ENDPOINT_ENV = 'STORAGE_S3_ENDPOINT';
export const STORAGE_S3_ACCESS_KEY_ID_ENV = 'STORAGE_S3_ACCESS_KEY_ID';
export const STORAGE_S3_SECRET_ACCESS_KEY_ENV = 'STORAGE_S3_SECRET_ACCESS_KEY';
export const STORAGE_S3_FORCE_PATH_STYLE_ENV = 'STORAGE_S3_FORCE_PATH_STYLE';

/** Env var for the local filesystem backend base directory. */
export const STORAGE_LOCAL_DIR_ENV = 'STORAGE_LOCAL_DIR';

/** Default backend when `STORAGE_DRIVER` is unset. Deliberately NOT `mock`. */
export const DEFAULT_STORAGE_DRIVER: StorageDriverType = 'local';
export const DEFAULT_STORAGE_LOCAL_DIR = 'uploads/evidence';

export interface LocalStorageConfig {
  baseDir: string;
}

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

export interface StorageConfig {
  /** Selected backend. */
  driver: StorageDriverType;
  /** Resolved options for the local backend (present when `driver === 'local'`). */
  local?: LocalStorageConfig;
  /** Resolved options for the S3 backend (present when `driver === 's3'`). */
  s3?: S3StorageConfig;
}

/** All selectable backend names. */
export const VALID_STORAGE_DRIVERS: StorageDriverType[] = [
  'local',
  's3',
  'mock',
];

/**
 * Pure parser turning a raw env map into a validated {@link StorageConfig}.
 * Throws {@link StorageConfigError} when the configuration is incoherent
 * (unknown driver, or missing required S3 settings). The `mock` driver is
 * permitted but never returned unless explicitly requested.
 */
export function parseStorageConfig(
  env: Record<string, unknown>,
): StorageConfig {
  const raw = (env[STORAGE_DRIVER_ENV] as string | undefined)?.trim();
  const driver = (raw || DEFAULT_STORAGE_DRIVER) as StorageDriverType;

  if (!VALID_STORAGE_DRIVERS.includes(driver)) {
    throw new Error(
      `Invalid ${STORAGE_DRIVER_ENV} "${raw}". ` +
        `Must be one of: ${VALID_STORAGE_DRIVERS.join(', ')}.`,
    );
  }

  if (driver === 's3') {
    const bucket = (env[STORAGE_S3_BUCKET_ENV] as string | undefined)?.trim();
    const region = (env[STORAGE_S3_REGION_ENV] as string | undefined)?.trim();
    if (!bucket) {
      throw new Error(
        `${STORAGE_S3_BUCKET_ENV} is required when ${STORAGE_DRIVER_ENV}=s3.`,
      );
    }
    if (!region) {
      throw new Error(
        `${STORAGE_S3_REGION_ENV} is required when ${STORAGE_DRIVER_ENV}=s3.`,
      );
    }
    const endpoint =
      (env[STORAGE_S3_ENDPOINT_ENV] as string | undefined)?.trim() || undefined;
    const forcePathStyleRaw = env[STORAGE_S3_FORCE_PATH_STYLE_ENV] as
      string | undefined;
    const forcePathStyle =
      forcePathStyleRaw === undefined
        ? !!endpoint
        : String(forcePathStyleRaw).toLowerCase() === 'true';
    return {
      driver,
      s3: {
        bucket,
        region,
        endpoint,
        accessKeyId:
          (env[STORAGE_S3_ACCESS_KEY_ID_ENV] as string | undefined)?.trim() ||
          undefined,
        secretAccessKey:
          (
            env[STORAGE_S3_SECRET_ACCESS_KEY_ENV] as string | undefined
          )?.trim() || undefined,
        forcePathStyle,
      },
    };
  }

  if (driver === 'local') {
    const baseDir =
      (env[STORAGE_LOCAL_DIR_ENV] as string | undefined)?.trim() ||
      DEFAULT_STORAGE_LOCAL_DIR;
    return { driver, local: { baseDir } };
  }

  // driver === 'mock'
  return { driver };
}
