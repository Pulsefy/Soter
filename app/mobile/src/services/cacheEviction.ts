/**
 * Shared LRU eviction utility for Soter offline caches.
 *
 * EVICTION POLICY
 * ───────────────
 * • Each cache enforces a configurable MAX_ENTRIES limit (entry count, because
 *   AsyncStorage stores serialised JSON and we don't measure byte sizes).
 * • Eviction target: Least-Recently-Used entries whose _syncStatus is 'synced'.
 *   An entry is "synced" when it has been confirmed persisted server-side
 *   (i.e. no matching pending/retrying/conflict action exists in the sync queue
 *   for that entry's id).
 * • An entry is NEVER evicted while _syncStatus is 'pending' or 'conflict' —
 *   those represent unsynced local changes that must reach the server first.
 * • If the cache is at capacity and ALL entries are unsynced, no eviction occurs.
 *   Instead callers receive { atLimit: true } so the UI can surface a warning.
 * • When eviction is needed, the entry with the smallest _lastAccessedAt
 *   timestamp (least-recently accessed) among synced entries is removed first,
 *   one at a time, until the entry count is under the limit.
 *
 * METADATA FIELDS (added to every cached entry, never sent to callers raw)
 * ─────────────────────────────────────────────────────────────────────────
 * • _lastAccessedAt: number  — Unix-ms timestamp, updated on every read/write.
 * • _syncStatus: 'synced' | 'pending' | 'conflict'
 *     - 'synced'   → no open sync-queue action for this id
 *     - 'pending'  → has a pending/retrying action in the sync queue
 *     - 'conflict' → has a conflict action in the sync queue
 *
 * These fields are stripped before entries are returned to callers, so the
 * public API shape of AidPackage / TaskItem is unchanged.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSyncQueueState, SyncActionState } from './syncQueue';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Sync states that mean "this entry must NOT be evicted". */
const UNSYNCED_STATES: SyncActionState[] = ['pending', 'retrying', 'conflict'];

export type EntrySyncStatus = 'synced' | 'pending' | 'conflict';

/** Metadata wrapper stored alongside every cached entry. */
export interface CacheEntryMeta {
  _lastAccessedAt: number;
  _syncStatus: EntrySyncStatus;
}

/** A cached entry is the original data type plus our metadata fields. */
export type WithMeta<T extends { id: string }> = T & CacheEntryMeta;

/** Result of an eviction run. */
export interface EvictionResult {
  /** Number of entries evicted. */
  evicted: number;
  /** True when the cache is at capacity AND every entry is unsynced — no data was dropped. */
  atLimit: boolean;
}

/** Shape returned by getCacheSize(). */
export interface CacheSize {
  entryCount: number;
  maxEntries: number;
  /** True when entryCount >= warningThreshold (default: 80 % of maxEntries). */
  nearLimit: boolean;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Derive a sync-status string for a given entry id by inspecting the live
 * sync-queue state.  We intentionally avoid importing the queue's internal
 * state directly to keep the coupling minimal.
 */
async function resolveSyncStatus(id: string): Promise<EntrySyncStatus> {
  const { items } = await getSyncQueueState();

  for (const action of items) {
    const payload = action.payload as Record<string, unknown>;
    // A queue action is "for" this entry if its payload contains the id.
    const matchesId =
      payload['aidId'] === id ||
      payload['claimId'] === id ||
      payload['id'] === id;

    if (!matchesId) continue;

    if (action.state === 'conflict') return 'conflict';
    if (UNSYNCED_STATES.includes(action.state)) return 'pending';
  }

  return 'synced';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Write an array of entries to AsyncStorage, attaching (or refreshing)
 * metadata.  Existing metadata is preserved for entries already in the cache;
 * new entries start with _syncStatus derived from the live sync queue.
 *
 * After writing, the eviction routine runs automatically and removes the
 * least-recently-accessed synced entries until the count is under maxEntries.
 *
 * @param storageKey   The AsyncStorage key for the cache blob.
 * @param data         Incoming entries (public shape — no metadata yet).
 * @param maxEntries   Hard cap on number of entries.
 * @param warningRatio Fraction of maxEntries at which nearLimit becomes true (default 0.8).
 * @returns EvictionResult for optional caller-side warning handling.
 */
export async function writeBoundedCache<T extends { id: string }>(
  storageKey: string,
  data: T[],
  maxEntries: number,
  warningRatio = 0.8,
): Promise<EvictionResult> {
  const now = Date.now();

  // Load existing entries so we can preserve their metadata.
  const existingRaw = await AsyncStorage.getItem(storageKey);
  const existing: WithMeta<T>[] = existingRaw ? (JSON.parse(existingRaw) as WithMeta<T>[]) : [];
  const existingById = new Map(existing.map((e) => [e.id, e]));

  // Attach metadata to every incoming entry.
  const incoming: WithMeta<T>[] = await Promise.all(
    data.map(async (entry) => {
      const prev = existingById.get(entry.id);
      const syncStatus = await resolveSyncStatus(entry.id);
      return {
        ...entry,
        _lastAccessedAt: now,
        _syncStatus: syncStatus,
        // Preserve prior access time if this is an unchanged read-through.
        ...(prev && prev._lastAccessedAt ? { _lastAccessedAt: prev._lastAccessedAt } : {}),
        // Always refresh access timestamp on write.
        _lastAccessedAt: now,
      };
    }),
  );

  // Run eviction on the merged set.
  return evictAndPersist(storageKey, incoming, maxEntries, warningRatio);
}

/**
 * Read entries from the cache, updating _lastAccessedAt on every entry
 * so LRU ordering stays accurate.
 *
 * Returns entries with metadata stripped — callers receive clean T[].
 */
export async function readBoundedCache<T extends { id: string }>(
  storageKey: string,
): Promise<T[] | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;

  const entries = JSON.parse(raw) as WithMeta<T>[];
  if (!entries.length) return [];

  const now = Date.now();
  const touched: WithMeta<T>[] = entries.map((e) => ({
    ...e,
    _lastAccessedAt: now,
  }));

  // Persist the updated timestamps quietly (fire-and-forget — reads shouldn't
  // block the caller).
  void AsyncStorage.setItem(storageKey, JSON.stringify(touched));

  return touched.map(stripMeta) as T[];
}

/**
 * Return the current cache size metrics.
 */
export async function getCacheSize(
  storageKey: string,
  maxEntries: number,
  warningRatio = 0.8,
): Promise<CacheSize> {
  const raw = await AsyncStorage.getItem(storageKey);
  const entries: WithMeta<unknown>[] = raw ? (JSON.parse(raw) as WithMeta<unknown>[]) : [];
  const entryCount = entries.length;
  const warningThreshold = Math.floor(maxEntries * warningRatio);

  return {
    entryCount,
    maxEntries,
    nearLimit: entryCount >= warningThreshold,
  };
}

/**
 * Clear all synced entries from the cache, preserving any entry whose
 * _syncStatus is 'pending' or 'conflict'.
 *
 * @returns Object with counts of cleared and preserved entries.
 */
export async function clearSyncedEntries<T extends { id: string }>(
  storageKey: string,
  timestampKey: string,
): Promise<{ cleared: number; preserved: number }> {
  const raw = await AsyncStorage.getItem(storageKey);
  const entries: WithMeta<T>[] = raw ? (JSON.parse(raw) as WithMeta<T>[]) : [];

  // Refresh sync statuses before deciding what to keep.
  const refreshed = await Promise.all(
    entries.map(async (e) => ({
      ...e,
      _syncStatus: await resolveSyncStatus(e.id),
    })),
  );

  const toKeep = refreshed.filter((e) => e._syncStatus !== 'synced');
  const cleared = refreshed.length - toKeep.length;

  if (toKeep.length === 0) {
    await AsyncStorage.multiRemove([storageKey, timestampKey]);
  } else {
    await AsyncStorage.setItem(storageKey, JSON.stringify(toKeep));
    await AsyncStorage.setItem(timestampKey, Date.now().toString());
  }

  return { cleared, preserved: toKeep.length };
}

/**
 * Force-clear ALL entries including unsynced ones.  This is a destructive
 * operation and must only be called from an explicitly confirmed UI action.
 */
export async function clearAllEntries(
  storageKey: string,
  timestampKey: string,
): Promise<void> {
  await AsyncStorage.multiRemove([storageKey, timestampKey]);
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Remove metadata fields before returning entries to callers. */
function stripMeta<T extends { id: string }>(entry: WithMeta<T>): T {
  const { _lastAccessedAt: _a, _syncStatus: _s, ...rest } = entry as WithMeta<T> & Record<string, unknown>;
  return rest as T;
}

/**
 * Core eviction loop: given a list of entries with metadata, remove the
 * least-recently-used synced entries until the count is under maxEntries,
 * then persist the result.
 */
async function evictAndPersist<T extends { id: string }>(
  storageKey: string,
  entries: WithMeta<T>[],
  maxEntries: number,
  warningRatio: number,
): Promise<EvictionResult> {
  let current = [...entries];
  let evicted = 0;

  while (current.length > maxEntries) {
    // Find the LRU synced entry.
    const syncedEntries = current.filter((e) => e._syncStatus === 'synced');

    if (syncedEntries.length === 0) {
      // All entries are unsynced — cannot evict without data loss.
      await AsyncStorage.setItem(storageKey, JSON.stringify(current));
      const warningThreshold = Math.floor(maxEntries * warningRatio);
      return {
        evicted,
        atLimit: current.length >= warningThreshold,
      };
    }

    // Pick entry with the smallest (oldest) _lastAccessedAt.
    const lru = syncedEntries.reduce((oldest, e) =>
      e._lastAccessedAt < oldest._lastAccessedAt ? e : oldest,
    );

    current = current.filter((e) => e.id !== lru.id);
    evicted++;
  }

  await AsyncStorage.setItem(storageKey, JSON.stringify(current));
  const warningThreshold = Math.floor(maxEntries * warningRatio);
  return {
    evicted,
    atLimit: current.length >= warningThreshold,
  };
}
