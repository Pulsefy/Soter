import { validateNetworkConfig } from './network-config.validation';
import { validateStorageConfig } from '../evidence/storage/storage.validation';

/**
 * Combined startup validation for ConfigModule.
 *
 * Fails fast on boot when any required configuration is missing or
 * contradictory (network consistency, storage backend selection, ...).
 */
export function validateAppConfig(
  env: Record<string, unknown>,
): Record<string, unknown> {
  validateNetworkConfig(env);
  validateStorageConfig(env);
  return env;
}
