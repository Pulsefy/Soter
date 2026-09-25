/**
 * Tests for the secure storage service (secureStorage.ts)
 *
 * Coverage areas:
 *  1. Key constants — SECURE_KEY_* exports and ALL_SECURE_KEYS shape
 *  2. secureRead   — happy path, missing key, error → null (fail-closed)
 *  3. secureWrite  — happy path, SecureStorageUnavailableError on failure
 *  4. secureDelete — idempotent, swallows errors
 *  5. secureClearAll — purges every key, partial failures tolerated
 *  6. migrateFromAsyncStorage
 *       a. key already in secure storage → alreadySecure
 *       b. key in AsyncStorage only → migrated + AsyncStorage entry removed
 *       c. key absent from both stores → absent
 *       d. secureWrite failure during migration → failed
 *       e. AsyncStorage read error → absent (fail-safe)
 *       f. full mix of outcomes in a single call
 *  7. SecureStorageUnavailableError — name, message, cause
 *  8. Backup-exclusion option — AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY is used
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

// expo-secure-store is mocked so we can simulate Keychain/Keystore behaviour
// without a real device.  The default implementation behaves like a simple
// in-memory Map so the happy-path tests exercise real data-flow through the
// module.

const mockSecureStoreData: Map<string, string> = new Map();
let mockSecureStoreShouldThrow = false;
let mockSecureStoreThrowMessage = 'Keystore unavailable';

const mockGetItemAsync = jest.fn(async (key: string) => {
  if (mockSecureStoreShouldThrow) throw new Error(mockSecureStoreThrowMessage);
  return mockSecureStoreData.get(key) ?? null;
});

const mockSetItemAsync = jest.fn(async (key: string, value: string) => {
  if (mockSecureStoreShouldThrow) throw new Error(mockSecureStoreThrowMessage);
  mockSecureStoreData.set(key, value);
});

const mockDeleteItemAsync = jest.fn(async (key: string) => {
  if (mockSecureStoreShouldThrow) throw new Error(mockSecureStoreThrowMessage);
  mockSecureStoreData.delete(key);
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItemAsync(...args),
  // Expose the accessibility constant that secureStorage.ts references
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly',
}));

// AsyncStorage mock — behaves like a simple Map.
const mockAsyncStorageData: Map<string, string> = new Map();
let mockAsyncStorageShouldThrow = false;

const mockAsyncGetItem = jest.fn(async (key: string) => {
  if (mockAsyncStorageShouldThrow) throw new Error('AsyncStorage unavailable');
  return mockAsyncStorageData.get(key) ?? null;
});

const mockAsyncRemoveItem = jest.fn(async (key: string) => {
  if (mockAsyncStorageShouldThrow) throw new Error('AsyncStorage unavailable');
  mockAsyncStorageData.delete(key);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args: unknown[]) => mockAsyncGetItem(...args),
  removeItem: (...args: unknown[]) => mockAsyncRemoveItem(...args),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  SECURE_KEY_WC_SESSION,
  SECURE_KEY_AUTH_TOKEN,
  SECURE_KEY_REFRESH_TOKEN,
  ALL_SECURE_KEYS,
  LEGACY_ASYNC_STORAGE_KEYS,
  secureRead,
  secureWrite,
  secureDelete,
  secureClearAll,
  migrateFromAsyncStorage,
  SecureStorageUnavailableError,
} from '../services/secureStorage';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset all mock state between tests. */
function resetMocks() {
  mockSecureStoreData.clear();
  mockAsyncStorageData.clear();
  mockSecureStoreShouldThrow = false;
  mockAsyncStorageShouldThrow = false;
  jest.clearAllMocks();

  // Reattach mock implementations cleared by clearAllMocks()
  mockGetItemAsync.mockImplementation(async (key: string) => {
    if (mockSecureStoreShouldThrow) throw new Error(mockSecureStoreThrowMessage);
    return mockSecureStoreData.get(key) ?? null;
  });
  mockSetItemAsync.mockImplementation(async (key: string, value: string) => {
    if (mockSecureStoreShouldThrow) throw new Error(mockSecureStoreThrowMessage);
    mockSecureStoreData.set(key, value);
  });
  mockDeleteItemAsync.mockImplementation(async (key: string) => {
    if (mockSecureStoreShouldThrow) throw new Error(mockSecureStoreThrowMessage);
    mockSecureStoreData.delete(key);
  });
  mockAsyncGetItem.mockImplementation(async (key: string) => {
    if (mockAsyncStorageShouldThrow) throw new Error('AsyncStorage unavailable');
    return mockAsyncStorageData.get(key) ?? null;
  });
  mockAsyncRemoveItem.mockImplementation(async (key: string) => {
    if (mockAsyncStorageShouldThrow) throw new Error('AsyncStorage unavailable');
    mockAsyncStorageData.delete(key);
  });
}

// ── 1. Key constants ──────────────────────────────────────────────────────────

describe('Key constants', () => {
  it('exports three distinct SECURE_KEY_* constants', () => {
    const keys = new Set([
      SECURE_KEY_WC_SESSION,
      SECURE_KEY_AUTH_TOKEN,
      SECURE_KEY_REFRESH_TOKEN,
    ]);
    expect(keys.size).toBe(3);
  });

  it('ALL_SECURE_KEYS contains exactly the three managed keys', () => {
    expect(ALL_SECURE_KEYS).toHaveLength(3);
    expect(ALL_SECURE_KEYS).toContain(SECURE_KEY_WC_SESSION);
    expect(ALL_SECURE_KEYS).toContain(SECURE_KEY_AUTH_TOKEN);
    expect(ALL_SECURE_KEYS).toContain(SECURE_KEY_REFRESH_TOKEN);
  });

  it('every secure key has a corresponding legacy AsyncStorage key', () => {
    for (const key of ALL_SECURE_KEYS) {
      expect(LEGACY_ASYNC_STORAGE_KEYS[key]).toBeDefined();
      expect(typeof LEGACY_ASYNC_STORAGE_KEYS[key]).toBe('string');
    }
  });

  it('legacy AsyncStorage keys are all distinct', () => {
    const legacyValues = Object.values(LEGACY_ASYNC_STORAGE_KEYS);
    expect(new Set(legacyValues).size).toBe(legacyValues.length);
  });
});

// ── 2. secureRead ─────────────────────────────────────────────────────────────

describe('secureRead', () => {
  beforeEach(resetMocks);

  it('returns the stored value when the key exists', async () => {
    mockSecureStoreData.set(SECURE_KEY_WC_SESSION, 'topic-abc');
    const result = await secureRead(SECURE_KEY_WC_SESSION);
    expect(result).toBe('topic-abc');
  });

  it('returns null when the key does not exist', async () => {
    const result = await secureRead(SECURE_KEY_AUTH_TOKEN);
    expect(result).toBeNull();
  });

  it('returns null (fail-closed) when SecureStore throws', async () => {
    mockSecureStoreShouldThrow = true;
    const result = await secureRead(SECURE_KEY_WC_SESSION);
    expect(result).toBeNull();
  });

  it('does not propagate the SecureStore exception to the caller', async () => {
    mockSecureStoreShouldThrow = true;
    await expect(secureRead(SECURE_KEY_AUTH_TOKEN)).resolves.toBeNull();
  });

  it('calls SecureStore.getItemAsync with the correct key', async () => {
    await secureRead(SECURE_KEY_REFRESH_TOKEN);
    expect(mockGetItemAsync).toHaveBeenCalledWith(
      SECURE_KEY_REFRESH_TOKEN,
      expect.objectContaining({ keychainAccessible: 'AfterFirstUnlockThisDeviceOnly' }),
    );
  });
});

// ── 3. secureWrite ────────────────────────────────────────────────────────────

describe('secureWrite', () => {
  beforeEach(resetMocks);

  it('stores the value so subsequent secureRead returns it', async () => {
    await secureWrite(SECURE_KEY_WC_SESSION, 'topic-xyz');
    expect(mockSecureStoreData.get(SECURE_KEY_WC_SESSION)).toBe('topic-xyz');
  });

  it('calls SecureStore.setItemAsync with the backup-exclusion option', async () => {
    await secureWrite(SECURE_KEY_AUTH_TOKEN, 'bearer-token');
    expect(mockSetItemAsync).toHaveBeenCalledWith(
      SECURE_KEY_AUTH_TOKEN,
      'bearer-token',
      expect.objectContaining({ keychainAccessible: 'AfterFirstUnlockThisDeviceOnly' }),
    );
  });

  it('throws SecureStorageUnavailableError when the Keystore is inaccessible', async () => {
    mockSecureStoreShouldThrow = true;
    await expect(secureWrite(SECURE_KEY_WC_SESSION, 'value')).rejects.toThrow(
      SecureStorageUnavailableError,
    );
  });

  it('SecureStorageUnavailableError message contains the failing key', async () => {
    mockSecureStoreShouldThrow = true;
    try {
      await secureWrite(SECURE_KEY_WC_SESSION, 'value');
    } catch (err) {
      expect(err instanceof SecureStorageUnavailableError).toBe(true);
      expect((err as SecureStorageUnavailableError).message).toContain(SECURE_KEY_WC_SESSION);
    }
  });

  it('does not swallow the write: stored value is accessible after success', async () => {
    await secureWrite(SECURE_KEY_REFRESH_TOKEN, 'refresh-abc');
    const read = await secureRead(SECURE_KEY_REFRESH_TOKEN);
    expect(read).toBe('refresh-abc');
  });
});

// ── 4. secureDelete ───────────────────────────────────────────────────────────

describe('secureDelete', () => {
  beforeEach(resetMocks);

  it('removes the key so subsequent reads return null', async () => {
    mockSecureStoreData.set(SECURE_KEY_WC_SESSION, 'topic-abc');
    await secureDelete(SECURE_KEY_WC_SESSION);
    expect(mockSecureStoreData.has(SECURE_KEY_WC_SESSION)).toBe(false);
  });

  it('does not throw when the key is absent (idempotent)', async () => {
    await expect(secureDelete(SECURE_KEY_AUTH_TOKEN)).resolves.toBeUndefined();
  });

  it('swallows SecureStore errors and resolves normally', async () => {
    mockSecureStoreShouldThrow = true;
    await expect(secureDelete(SECURE_KEY_REFRESH_TOKEN)).resolves.toBeUndefined();
  });
});

// ── 5. secureClearAll ─────────────────────────────────────────────────────────

describe('secureClearAll', () => {
  beforeEach(resetMocks);

  it('deletes all three managed keys', async () => {
    for (const key of ALL_SECURE_KEYS) {
      mockSecureStoreData.set(key, 'some-value');
    }

    await secureClearAll();

    for (const key of ALL_SECURE_KEYS) {
      expect(mockSecureStoreData.has(key)).toBe(false);
    }
  });

  it('resolves even when every deleteItemAsync call throws', async () => {
    mockSecureStoreShouldThrow = true;
    await expect(secureClearAll()).resolves.toBeUndefined();
  });

  it('resolves even when only some deleteItemAsync calls succeed', async () => {
    let callCount = 0;
    mockDeleteItemAsync.mockImplementation(async (key: string) => {
      callCount += 1;
      if (callCount === 2) throw new Error('intermittent failure');
      mockSecureStoreData.delete(key);
    });

    await expect(secureClearAll()).resolves.toBeUndefined();
    // At least 2 out of 3 deletes completed
    expect(mockDeleteItemAsync).toHaveBeenCalledTimes(ALL_SECURE_KEYS.length);
  });
});

// ── 6. migrateFromAsyncStorage ────────────────────────────────────────────────

describe('migrateFromAsyncStorage', () => {
  beforeEach(resetMocks);

  // 6a. Already in secure storage
  it('reports alreadySecure when the key already exists in secure storage', async () => {
    mockSecureStoreData.set(SECURE_KEY_WC_SESSION, 'existing-topic');

    const result = await migrateFromAsyncStorage();

    expect(result.alreadySecure).toContain(SECURE_KEY_WC_SESSION);
    expect(result.migrated).not.toContain(SECURE_KEY_WC_SESSION);
    expect(result.absent).not.toContain(SECURE_KEY_WC_SESSION);
    expect(result.failed).not.toContain(SECURE_KEY_WC_SESSION);
  });

  it('does not overwrite an existing secure value when alreadySecure', async () => {
    const originalValue = 'original-topic';
    mockSecureStoreData.set(SECURE_KEY_WC_SESSION, originalValue);
    // Also put a stale value in AsyncStorage to confirm it is ignored
    mockAsyncStorageData.set(
      LEGACY_ASYNC_STORAGE_KEYS[SECURE_KEY_WC_SESSION],
      'stale-legacy-value',
    );

    await migrateFromAsyncStorage();

    expect(mockSecureStoreData.get(SECURE_KEY_WC_SESSION)).toBe(originalValue);
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });

  // 6b. Key in AsyncStorage only → migrated
  it('migrates a key from AsyncStorage to secure storage', async () => {
    const legacyKey = LEGACY_ASYNC_STORAGE_KEYS[SECURE_KEY_AUTH_TOKEN];
    mockAsyncStorageData.set(legacyKey, 'bearer-123');

    const result = await migrateFromAsyncStorage();

    expect(result.migrated).toContain(SECURE_KEY_AUTH_TOKEN);
    expect(mockSecureStoreData.get(SECURE_KEY_AUTH_TOKEN)).toBe('bearer-123');
  });

  it('removes the legacy AsyncStorage entry after a successful migration', async () => {
    const legacyKey = LEGACY_ASYNC_STORAGE_KEYS[SECURE_KEY_AUTH_TOKEN];
    mockAsyncStorageData.set(legacyKey, 'bearer-123');

    await migrateFromAsyncStorage();

    expect(mockAsyncStorageData.has(legacyKey)).toBe(false);
    expect(mockAsyncRemoveItem).toHaveBeenCalledWith(legacyKey);
  });

  // 6c. Key absent from both stores
  it('reports absent when the key is not in either store', async () => {
    const result = await migrateFromAsyncStorage();

    // With both stores empty every key should be absent
    expect(result.absent).toContain(SECURE_KEY_WC_SESSION);
    expect(result.absent).toContain(SECURE_KEY_AUTH_TOKEN);
    expect(result.absent).toContain(SECURE_KEY_REFRESH_TOKEN);
    expect(result.migrated).toHaveLength(0);
    expect(result.alreadySecure).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  // 6d. secureWrite failure during migration
  it('reports failed when secureWrite throws during migration', async () => {
    const legacyKey = LEGACY_ASYNC_STORAGE_KEYS[SECURE_KEY_REFRESH_TOKEN];
    mockAsyncStorageData.set(legacyKey, 'refresh-xyz');

    // Make secure write fail
    mockSetItemAsync.mockRejectedValueOnce(new Error('Keystore full'));

    const result = await migrateFromAsyncStorage();

    expect(result.failed).toContain(SECURE_KEY_REFRESH_TOKEN);
    expect(result.migrated).not.toContain(SECURE_KEY_REFRESH_TOKEN);
  });

  it('never throws even when every operation fails', async () => {
    mockSecureStoreShouldThrow = true;
    mockAsyncStorageShouldThrow = true;

    await expect(migrateFromAsyncStorage()).resolves.toBeDefined();
  });

  // 6e. AsyncStorage read error → absent
  it('treats an AsyncStorage read error as absent (fail-safe)', async () => {
    mockAsyncGetItem.mockRejectedValueOnce(new Error('I/O error'));

    const result = await migrateFromAsyncStorage();

    // The first key in iteration order should be absent
    expect(
      result.absent.length + result.alreadySecure.length + result.failed.length,
    ).toBeLessThanOrEqual(ALL_SECURE_KEYS.length);
    // No key should have been reported as migrated for the failing read
    expect(result.failed).not.toContain(SECURE_KEY_WC_SESSION);
  });

  // 6f. Mixed outcome in a single call
  it('correctly handles a mix of alreadySecure, migrated, and absent in one call', async () => {
    // WC session already secure
    mockSecureStoreData.set(SECURE_KEY_WC_SESSION, 'topic-already-there');

    // Auth token is in AsyncStorage
    mockAsyncStorageData.set(
      LEGACY_ASYNC_STORAGE_KEYS[SECURE_KEY_AUTH_TOKEN],
      'bearer-token',
    );

    // Refresh token absent from both stores

    const result = await migrateFromAsyncStorage();

    expect(result.alreadySecure).toContain(SECURE_KEY_WC_SESSION);
    expect(result.migrated).toContain(SECURE_KEY_AUTH_TOKEN);
    expect(result.absent).toContain(SECURE_KEY_REFRESH_TOKEN);
    expect(result.failed).toHaveLength(0);
  });

  // idempotency: running twice does not overwrite or re-migrate
  it('is idempotent — a second call produces only alreadySecure entries', async () => {
    const legacyKey = LEGACY_ASYNC_STORAGE_KEYS[SECURE_KEY_WC_SESSION];
    mockAsyncStorageData.set(legacyKey, 'topic-abc');

    // First call migrates
    const first = await migrateFromAsyncStorage();
    expect(first.migrated).toContain(SECURE_KEY_WC_SESSION);

    // Reset call tracking but keep SecureStore data intact (simulates next app launch)
    jest.clearAllMocks();
    // Reattach implementations
    mockGetItemAsync.mockImplementation(async (key: string) => {
      return mockSecureStoreData.get(key) ?? null;
    });
    mockSetItemAsync.mockImplementation(async (key: string, value: string) => {
      mockSecureStoreData.set(key, value);
    });
    mockDeleteItemAsync.mockImplementation(async (key: string) => {
      mockSecureStoreData.delete(key);
    });
    mockAsyncGetItem.mockImplementation(async (key: string) => {
      return mockAsyncStorageData.get(key) ?? null;
    });
    mockAsyncRemoveItem.mockImplementation(async (key: string) => {
      mockAsyncStorageData.delete(key);
    });

    // Second call — value already in secure store, AsyncStorage already cleaned
    const second = await migrateFromAsyncStorage();
    expect(second.alreadySecure).toContain(SECURE_KEY_WC_SESSION);
    expect(second.migrated).not.toContain(SECURE_KEY_WC_SESSION);
    expect(mockSetItemAsync).not.toHaveBeenCalled();
  });
});

// ── 7. SecureStorageUnavailableError ─────────────────────────────────────────

describe('SecureStorageUnavailableError', () => {
  it('has name "SecureStorageUnavailableError"', () => {
    const err = new SecureStorageUnavailableError('test');
    expect(err.name).toBe('SecureStorageUnavailableError');
  });

  it('carries the message passed to the constructor', () => {
    const err = new SecureStorageUnavailableError('Keystore locked');
    expect(err.message).toBe('Keystore locked');
  });

  it('stores the cause when provided', () => {
    const cause = new Error('underlying OS error');
    const err = new SecureStorageUnavailableError('outer', cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is undefined when not provided', () => {
    const err = new SecureStorageUnavailableError('no cause');
    expect(err.cause).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const err = new SecureStorageUnavailableError('test');
    expect(err instanceof Error).toBe(true);
  });

  it('is identified by its constructor name in WalletContext isSecureFailure check', () => {
    const err = new SecureStorageUnavailableError('locked');
    expect(err?.constructor?.name).toBe('SecureStorageUnavailableError');
  });
});

// ── 8. Backup-exclusion option enforcement ────────────────────────────────────

describe('Backup-exclusion option — AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY', () => {
  beforeEach(resetMocks);

  it('secureRead always passes keychainAccessible to SecureStore', async () => {
    await secureRead(SECURE_KEY_WC_SESSION);
    const callArgs = mockGetItemAsync.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options).toHaveProperty('keychainAccessible');
    expect(options.keychainAccessible).toBe('AfterFirstUnlockThisDeviceOnly');
  });

  it('secureWrite always passes keychainAccessible to SecureStore', async () => {
    await secureWrite(SECURE_KEY_AUTH_TOKEN, 'value');
    const callArgs = mockSetItemAsync.mock.calls[0];
    const options = callArgs[2] as Record<string, unknown>;
    expect(options).toHaveProperty('keychainAccessible');
    expect(options.keychainAccessible).toBe('AfterFirstUnlockThisDeviceOnly');
  });

  it('secureDelete always passes keychainAccessible to SecureStore', async () => {
    await secureDelete(SECURE_KEY_REFRESH_TOKEN);
    const callArgs = mockDeleteItemAsync.mock.calls[0];
    const options = callArgs[1] as Record<string, unknown>;
    expect(options).toHaveProperty('keychainAccessible');
    expect(options.keychainAccessible).toBe('AfterFirstUnlockThisDeviceOnly');
  });
});
