import { parseStorageConfig } from './storage.config';

/**
 * ConfigModule `validate` hook for storage settings.
 *
 * Runs at application bootstrap so a missing/invalid `STORAGE_DRIVER` (or
 * incomplete S3 configuration) fails fast instead of letting evidence uploads
 * silently no-op later. Returns `env` unchanged on success so it can be
 * composed with other validators.
 */
export function validateStorageConfig(
  env: Record<string, unknown>,
): Record<string, unknown> {
  parseStorageConfig(env);
  return env;
}
