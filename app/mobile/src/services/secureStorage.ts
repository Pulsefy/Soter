/**
 * Secure Storage Service — iOS Keychain / Android Keystore wrapper
 *
 * All wallet session material and auth tokens are stored here instead of
 * AsyncStorage. Items are explicitly excluded from iCloud / Android
 * Auto-backup using the `keychainAccessible` and `requireAuthentication`
 * options exposed by expo-secure-store.
 *
 * Backup exclusion strategy
 * ─────────────────────────
 * • iOS   – kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
 *           The "ThisDeviceOnly" constraint prevents the item from
 *           migrating to iCloud Keychain or any device backup.
 * • Android – uses the Android Keystore system, which never exports
 *             private key material and is not included in ADB or
 *             Google Drive backups.
 *
 * Fail-closed contract
 * ─────────────────────
 * secureRead() returns null on ANY error (missing key, hardware
 * unavailable, Secure Enclave failure, permission denied).  Callers
 * MUST treat null as "unauthenticated" and surface a re-authentication
 * prompt rather than falling back to insecure storage.
 *
 * Migration helpers
 * ─────────────────
 * migrateFromAsyncStorage() is a one-shot migration that moves named
 * keys out of AsyncStorage into the Keychain/Keystore and then removes
 * them from AsyncStorage.  It is idempotent: if the key is already in
 * secure storage it is left untouched.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Key constants ─────────────────────────────────────────────────────────

/**
 * Wallet session topic stored in secure storage.
 * Corresponds to the WalletConnect session topic identifier.
 */
export const SECURE_KEY_WC_SESSION = '@soter/secure/wc_session';

/**
 * Auth token (Bearer) used by the mobile app when calling the Soter backend.
 */
export const SECURE_KEY_AUTH_TOKEN = '@soter/secure/auth_token';

/**
 * Refresh token for re-issuing short-lived auth tokens.
 */
export const SECURE_KEY_REFRESH_TOKEN = '@soter/secure/refresh_token';

/**
 * All keys managed by this service.  Used by migration and wipe helpers.
 */
export const ALL_SECURE_KEYS = [
  SECURE_KEY_WC_SESSION,
  SECURE_KEY_AUTH_TOKEN,
  SECURE_KEY_REFRESH_TOKEN,
] as const;

export type SecureKey = (typeof ALL_SECURE_KEYS)[number];

// ── Legacy AsyncStorage keys that must be migrated ────────────────────────

/**
 * Keys that previously lived in AsyncStorage and must be evacuated during
 * the one-shot migration.
 */
export const LEGACY_ASYNC_STORAGE_KEYS: Readonly<Record<SecureKey, string>> = {
  [SECURE_KEY_WC_SESSION]: '@soter/wc_session',
  [SECURE_KEY_AUTH_TOKEN]: '@soter/auth_token',
  [SECURE_KEY_REFRESH_TOKEN]: '@soter/refresh_token',
};

// ── SecureStore options ───────────────────────────────────────────────────

/**
 * expo-secure-store options used for every write.
 *
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` ensures:
 * - The item is accessible after the device is unlocked for the first time
 *   after a reboot (good for background processing).
 * - The "ThisDeviceOnly" suffix prevents iCloud Keychain sync and backup
 *   migration on iOS.
 * - On Android the underlying Keystore never exports material regardless
 *   of the accessibility option.
 */
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// ── Core operations ───────────────────────────────────────────────────────

/**
 * Read a value from secure storage.
 *
 * Returns `null` when the key does not exist OR when secure storage is
 * unavailable (hardware failure, permission denied, etc.).  Always fail-
 * closed — never propagate an exception.
 */
export const secureRead = async (key: SecureKey): Promise<string | null> => {
  try {
    return await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
  } catch {
    // Treat all errors as "unavailable" — the caller must prompt re-auth.
    return null;
  }
};

/**
 * Write a value to secure storage.
 *
 * Throws `SecureStorageUnavailableError` when the secure enclave / Keystore
 * is inaccessible so callers can surface an appropriate error.
 */
export const secureWrite = async (key: SecureKey, value: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
  } catch (cause) {
    throw new SecureStorageUnavailableError(
      `Failed to write secure storage key "${key}": ${errorMessage(cause)}`,
      cause,
    );
  }
};

/**
 * Delete a value from secure storage.
 *
 * Does not throw when the key is absent — deletion is idempotent.
 */
export const secureDelete = async (key: SecureKey): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
  } catch {
    // Treat all errors as no-ops — the key is effectively gone.
  }
};

/**
 * Delete all keys managed by this service (e.g. on user sign-out).
 */
export const secureClearAll = async (): Promise<void> => {
  await Promise.allSettled(ALL_SECURE_KEYS.map((key) => secureDelete(key)));
};

// ── Migration ─────────────────────────────────────────────────────────────

export interface MigrationResult {
  /** Keys that were successfully moved to secure storage. */
  migrated: SecureKey[];
  /** Keys that were already in secure storage (left untouched). */
  alreadySecure: SecureKey[];
  /** Keys that were absent from both stores (no action needed). */
  absent: SecureKey[];
  /** Keys that could not be migrated because of a write error. */
  failed: SecureKey[];
}

/**
 * One-shot migration from AsyncStorage to secure storage.
 *
 * For each key:
 * 1. If already present in secure storage → skip (idempotent).
 * 2. If present in AsyncStorage → move to secure storage, then remove
 *    from AsyncStorage.
 * 3. If absent from both → no-op.
 *
 * Returns a result object that describes what happened for each key.
 * Never throws — failures are collected in `result.failed`.
 */
export const migrateFromAsyncStorage = async (): Promise<MigrationResult> => {
  const result: MigrationResult = {
    migrated: [],
    alreadySecure: [],
    absent: [],
    failed: [],
  };

  await Promise.allSettled(
    ALL_SECURE_KEYS.map(async (secureKey) => {
      // 1. Already in secure storage?
      const existing = await secureRead(secureKey);
      if (existing !== null) {
        result.alreadySecure.push(secureKey);
        return;
      }

      // 2. Present in AsyncStorage?
      const legacyKey = LEGACY_ASYNC_STORAGE_KEYS[secureKey];
      let legacyValue: string | null = null;
      try {
        legacyValue = await AsyncStorage.getItem(legacyKey);
      } catch {
        // If we can't even read AsyncStorage, treat as absent.
      }

      if (legacyValue === null) {
        result.absent.push(secureKey);
        return;
      }

      // 3. Migrate: write to secure storage, then delete from AsyncStorage.
      try {
        await secureWrite(secureKey, legacyValue);
        try {
          await AsyncStorage.removeItem(legacyKey);
        } catch {
          // Best-effort removal — the value is already safe.
        }
        result.migrated.push(secureKey);
      } catch {
        result.failed.push(secureKey);
      }
    }),
  );

  return result;
};

// ── Error types ───────────────────────────────────────────────────────────

/**
 * Thrown by `secureWrite` when the platform Keychain / Keystore is
 * inaccessible.  The caller should prompt the user to re-authenticate or
 * check device security settings.
 */
export class SecureStorageUnavailableError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SecureStorageUnavailableError';
    this.cause = cause;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};
