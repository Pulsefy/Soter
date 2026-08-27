/**
 * Task list offline cache — bounded LRU with safe eviction.
 *
 * EVICTION POLICY (see cacheEviction.ts for full documentation)
 * ─────────────────────────────────────────────────────────────
 * • Maximum entries: TASK_CACHE_MAX_ENTRIES (default 500, configurable via
 *   EXPO_PUBLIC_TASK_CACHE_MAX_ENTRIES environment variable).
 * • Eviction order: Least-Recently-Used (by _lastAccessedAt timestamp) among
 *   entries whose _syncStatus is 'synced'.
 * • Entries with _syncStatus 'pending' or 'conflict' are NEVER evicted — they
 *   represent unsynced local changes that must reach the server first.
 * • If at capacity and all entries are unsynced, no data is dropped; the caller
 *   receives { atLimit: true } which the UI uses to surface a warning.
 * • A warning threshold fires at 80 % of the limit (configurable).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { TaskItem } from './taskApi';
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
 * Maximum number of task entries to keep in the local cache.
 * Override via EXPO_PUBLIC_TASK_CACHE_MAX_ENTRIES at build time.
 */
export const TASK_CACHE_MAX_ENTRIES: number = process.env.EXPO_PUBLIC_TASK_CACHE_MAX_ENTRIES
  ? parseInt(process.env.EXPO_PUBLIC_TASK_CACHE_MAX_ENTRIES, 10)
  : 500;

const CACHE_KEY = '@soter/task_list';
const CACHE_TIMESTAMP_KEY = '@soter/task_list_timestamp';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Persist task list to AsyncStorage.
 *
 * Runs the LRU eviction policy after writing.  Synced entries are evicted
 * LRU-first; unsynced entries are never dropped.
 *
 * @returns EvictionResult — check `atLimit` to surface a capacity warning.
 */
export const cacheTaskList = async (data: TaskItem[]): Promise<EvictionResult> => {
  const result = await writeBoundedCache<TaskItem>(CACHE_KEY, data, TASK_CACHE_MAX_ENTRIES);
  await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  return result;
};

/**
 * Load cached task list from AsyncStorage.
 * Updates _lastAccessedAt on all entries (LRU tracking).
 */
export const loadCachedTaskList = async (): Promise<TaskItem[] | null> => {
  return readBoundedCache<TaskItem>(CACHE_KEY);
};

/**
 * Returns the human-readable timestamp of the last successful cache write,
 * or null if the cache has never been written.
 */
export const getTaskCacheTimestamp = async (): Promise<string | null> => {
  const ts = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10)).toLocaleString();
};

/**
 * Returns current cache size metrics for the settings UI.
 * `nearLimit` is true when usage reaches 80 % of TASK_CACHE_MAX_ENTRIES.
 */
export const getTaskCacheSize = async (): Promise<CacheSize> => {
  return getCacheSize(CACHE_KEY, TASK_CACHE_MAX_ENTRIES);
};

/**
 * Clear synced task entries only.  Entries with pending/conflict sync state
 * are preserved — they have not yet reached the server.
 *
 * @returns Counts of cleared and preserved entries.
 */
export const clearTaskCache = async (): Promise<{ cleared: number; preserved: number }> => {
  return clearSyncedEntries<TaskItem>(CACHE_KEY, CACHE_TIMESTAMP_KEY);
};

/**
 * Force-clear ALL cached task entries including any with unsynced changes.
 *
 * ⚠️  DESTRUCTIVE — call only from a separately-confirmed UI action.
 *     Unsynced data will be permanently lost if this is called before the
 *     sync queue has flushed those entries to the server.
 */
export const forceClearTaskCache = async (): Promise<void> => {
  return clearAllEntries(CACHE_KEY, CACHE_TIMESTAMP_KEY);
};
