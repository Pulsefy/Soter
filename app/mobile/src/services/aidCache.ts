/**
 * Aid package offline cache — bounded LRU with safe eviction.
 *
 * EVICTION POLICY (see cacheEviction.ts for full documentation)
 * ─────────────────────────────────────────────────────────────
 * • Maximum entries: AID_CACHE_MAX_ENTRIES (default 200, configurable via
 *   EXPO_PUBLIC_AID_CACHE_MAX_ENTRIES environment variable).
 * • Eviction order: Least-Recently-Used (by _lastAccessedAt timestamp) among
 *   entries whose _syncStatus is 'synced'.
 * • Entries with _syncStatus 'pending' or 'conflict' are NEVER evicted — they
 *   represent unsynced local changes that must reach the server first.
 * • If at capacity and all entries are unsynced, no data is dropped; the caller
 *   receives { atLimit: true } which the UI uses to surface a warning.
 * • A warning threshold fires at 80 % of the limit (configurable).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AidPackage } from './api';
import {
  writeBoundedCache,
  readBoundedCache,
  getCacheSize,
  clearSyncedEntries,
  clearAllEntries,
  CacheSize,
  EvictionResult,
} from './cacheEviction';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Maximum number of aid package entries to keep in the local cache.
 * Override via EXPO_PUBLIC_AID_CACHE_MAX_ENTRIES at build time.
 */
export const AID_CACHE_MAX_ENTRIES: number = process.env.EXPO_PUBLIC_AID_CACHE_MAX_ENTRIES
  ? parseInt(process.env.EXPO_PUBLIC_AID_CACHE_MAX_ENTRIES, 10)
  : 200;

const CACHE_KEY = '@soter/aid_overview';
const CACHE_TIMESTAMP_KEY = '@soter/aid_overview_timestamp';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Persist aid list to AsyncStorage.
 *
 * Runs the LRU eviction policy after writing.  Synced entries are evicted
 * LRU-first; unsynced entries are never dropped.
 *
 * @returns EvictionResult — check `atLimit` to surface a capacity warning.
 */
export const cacheAidList = async (data: AidPackage[]): Promise<EvictionResult> => {
  const result = await writeBoundedCache<AidPackage>(CACHE_KEY, data, AID_CACHE_MAX_ENTRIES);
  await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  return result;
};

/**
 * Load cached aid list from AsyncStorage.
 * Updates _lastAccessedAt on all entries (LRU tracking).
 */
export const loadCachedAidList = async (): Promise<AidPackage[] | null> => {
  return readBoundedCache<AidPackage>(CACHE_KEY);
};

/**
 * Returns the human-readable timestamp of the last successful cache write,
 * or null if the cache has never been written.
 */
export const getCacheTimestamp = async (): Promise<string | null> => {
  const ts = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10)).toLocaleString();
};

/**
 * Returns current cache size metrics for the settings UI.
 * `nearLimit` is true when usage reaches 80 % of AID_CACHE_MAX_ENTRIES.
 */
export const getAidCacheSize = async (): Promise<CacheSize> => {
  return getCacheSize(CACHE_KEY, AID_CACHE_MAX_ENTRIES);
};

/**
 * Clear synced aid entries only.  Entries with pending/conflict sync state
 * are preserved — they have not yet reached the server.
 *
 * @returns Counts of cleared and preserved entries.
 */
export const clearAidCache = async (): Promise<{ cleared: number; preserved: number }> => {
  return clearSyncedEntries<AidPackage>(CACHE_KEY, CACHE_TIMESTAMP_KEY);
};

/**
 * Force-clear ALL cached aid entries including any with unsynced changes.
 *
 * ⚠️  DESTRUCTIVE — call only from a separately-confirmed UI action.
 *     Unsynced data will be permanently lost if this is called before the
 *     sync queue has flushed those entries to the server.
 */
export const forceclearAidCache = async (): Promise<void> => {
  return clearAllEntries(CACHE_KEY, CACHE_TIMESTAMP_KEY);
};
