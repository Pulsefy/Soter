/**
 * Tests for the bounded LRU cache eviction utility (cacheEviction.ts).
 *
 * Test framework: Jest (jest-expo preset).
 * AsyncStorage is mocked via the global setup in jest.setup.ts.
 * The sync-queue module is mocked here to control which entry ids appear
 * as pending/conflict without needing a full queue hydration.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  writeBoundedCache,
  readBoundedCache,
  getCacheSize,
  clearSyncedEntries,
  clearAllEntries,
  WithMeta,
} from '../services/cacheEviction';

// ─── Mock syncQueue ────────────────────────────────────────────────────────

jest.mock('../services/syncQueue', () => ({
  getSyncQueueState: jest.fn(),
}));

import { getSyncQueueState } from '../services/syncQueue';
const mockGetSyncQueueState = getSyncQueueState as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────

interface Item {
  id: string;
  value: string;
}

const STORAGE_KEY = '@test/cache';
const TIMESTAMP_KEY = '@test/cache_ts';

/** Build a queue state that marks the given ids as pending. */
function pendingQueueState(pendingIds: string[], conflictIds: string[] = []) {
  const items = [
    ...pendingIds.map((id) => ({
      id: `action-${id}`,
      type: 'status-refresh',
      payload: { aidId: id },
      state: 'pending',
      retryCount: 0,
      maxRetries: 5,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: null,
    })),
    ...conflictIds.map((id) => ({
      id: `action-conflict-${id}`,
      type: 'status-refresh',
      payload: { aidId: id },
      state: 'conflict',
      retryCount: 1,
      maxRetries: 5,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: 'conflict',
    })),
  ];
  return { items, isSyncing: false, lastSyncAt: null, lastSyncError: null };
}

/** Write entries directly to AsyncStorage with controlled metadata (bypass writeBoundedCache). */
async function seedCacheWithMeta(entries: WithMeta<Item>[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

beforeEach(async () => {
  // Clear the mock AsyncStorage before every test.
  await AsyncStorage.clear();
  mockGetSyncQueueState.mockResolvedValue(pendingQueueState([]));
});

// ─── 1. Eviction ordering ─────────────────────────────────────────────────

describe('eviction ordering', () => {
  it('evicts the least-recently-used synced entry first', async () => {
    // 3 synced entries with different access times, max 2 entries.
    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'synced' },
      { id: 'b', value: 'B', _lastAccessedAt: 3000, _syncStatus: 'synced' }, // most recent
      { id: 'c', value: 'C', _lastAccessedAt: 2000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    const result = await writeBoundedCache<Item>(
      STORAGE_KEY,
      // Re-write all three as "fresh data" with the same ids
      entries.map(({ id, value }) => ({ id, value })),
      2,
    );

    expect(result.evicted).toBe(1);
    const remaining = await readBoundedCache<Item>(STORAGE_KEY);
    const ids = remaining!.map((e) => e.id).sort();
    // 'a' (oldest) should be evicted; 'b' and 'c' should remain.
    expect(ids).toEqual(['b', 'c']);
  });

  it('evicts multiple entries until under the limit, oldest first', async () => {
    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'synced' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'synced' },
      { id: 'c', value: 'C', _lastAccessedAt: 3000, _syncStatus: 'synced' },
      { id: 'd', value: 'D', _lastAccessedAt: 4000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    const result = await writeBoundedCache<Item>(
      STORAGE_KEY,
      entries.map(({ id, value }) => ({ id, value })),
      2,
    );

    expect(result.evicted).toBe(2);
    const remaining = await readBoundedCache<Item>(STORAGE_KEY);
    const ids = remaining!.map((e) => e.id).sort();
    // 'a' (ts 1000) and 'b' (ts 2000) evicted; 'c' and 'd' kept.
    expect(ids).toEqual(['c', 'd']);
  });
});

// ─── 2. Unsynced preservation ─────────────────────────────────────────────

describe('unsynced preservation', () => {
  it('never evicts pending entries even if they are the oldest', async () => {
    // 'a' is oldest but pending — must not be evicted.
    mockGetSyncQueueState.mockResolvedValue(pendingQueueState(['a']));

    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'pending' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'synced' },
      { id: 'c', value: 'C', _lastAccessedAt: 3000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    await writeBoundedCache<Item>(
      STORAGE_KEY,
      entries.map(({ id, value }) => ({ id, value })),
      2,
    );

    const remaining = await readBoundedCache<Item>(STORAGE_KEY);
    const ids = remaining!.map((e) => e.id);
    expect(ids).toContain('a'); // unsynced, must survive
    expect(ids).not.toContain('b'); // oldest synced, evicted
    expect(ids).toContain('c');
  });

  it('never evicts conflict entries', async () => {
    mockGetSyncQueueState.mockResolvedValue(pendingQueueState([], ['a']));

    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 500, _syncStatus: 'conflict' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'synced' },
      { id: 'c', value: 'C', _lastAccessedAt: 3000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    await writeBoundedCache<Item>(
      STORAGE_KEY,
      entries.map(({ id, value }) => ({ id, value })),
      2,
    );

    const remaining = await readBoundedCache<Item>(STORAGE_KEY);
    const ids = remaining!.map((e) => e.id);
    expect(ids).toContain('a'); // conflict, must survive
  });
});

// ─── 3. All-unsynced-at-capacity ─────────────────────────────────────────

describe('all-unsynced-at-capacity', () => {
  it('does not drop any data when all entries are unsynced', async () => {
    mockGetSyncQueueState.mockResolvedValue(pendingQueueState(['a', 'b', 'c']));

    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'pending' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'pending' },
      { id: 'c', value: 'C', _lastAccessedAt: 3000, _syncStatus: 'pending' },
    ];
    await seedCacheWithMeta(entries);

    const result = await writeBoundedCache<Item>(
      STORAGE_KEY,
      entries.map(({ id, value }) => ({ id, value })),
      2, // maxEntries below current count
    );

    // No eviction should have happened.
    expect(result.evicted).toBe(0);

    // All three entries must still be present.
    const remaining = await readBoundedCache<Item>(STORAGE_KEY);
    expect(remaining).toHaveLength(3);
  });

  it('sets atLimit true when at capacity with all unsynced entries', async () => {
    mockGetSyncQueueState.mockResolvedValue(pendingQueueState(['a', 'b']));

    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'pending' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'pending' },
    ];
    await seedCacheWithMeta(entries);

    const result = await writeBoundedCache<Item>(
      STORAGE_KEY,
      entries.map(({ id, value }) => ({ id, value })),
      2,
      0.8, // warningRatio — 80% of 2 = 1.6, floor = 1; 2 entries >= 1 → nearLimit
    );

    expect(result.atLimit).toBe(true);
  });
});

// ─── 4. Manual clear ─────────────────────────────────────────────────────

describe('clearSyncedEntries', () => {
  it('removes synced entries and preserves unsynced entries', async () => {
    mockGetSyncQueueState.mockResolvedValue(pendingQueueState(['b']));

    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'synced' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'pending' },
      { id: 'c', value: 'C', _lastAccessedAt: 3000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    const { cleared, preserved } = await clearSyncedEntries<Item>(STORAGE_KEY, TIMESTAMP_KEY);

    expect(cleared).toBe(2);
    expect(preserved).toBe(1);

    const remaining = await readBoundedCache<Item>(STORAGE_KEY);
    expect(remaining).toHaveLength(1);
    expect(remaining![0].id).toBe('b');
  });

  it('returns cleared=all, preserved=0 when all entries are synced', async () => {
    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'synced' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    const { cleared, preserved } = await clearSyncedEntries<Item>(STORAGE_KEY, TIMESTAMP_KEY);

    expect(cleared).toBe(2);
    expect(preserved).toBe(0);

    // Cache should be fully cleared.
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).toBeNull();
  });
});

describe('clearAllEntries', () => {
  it('removes all entries including unsynced ones', async () => {
    mockGetSyncQueueState.mockResolvedValue(pendingQueueState(['a']));

    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'pending' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    await clearAllEntries(STORAGE_KEY, TIMESTAMP_KEY);

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(raw).toBeNull();
  });
});

// ─── 5. Size / count reporting ────────────────────────────────────────────

describe('getCacheSize', () => {
  it('returns entryCount=0 for an empty cache', async () => {
    const size = await getCacheSize(STORAGE_KEY, 200);
    expect(size.entryCount).toBe(0);
    expect(size.nearLimit).toBe(false);
  });

  it('accurately counts entries after writes', async () => {
    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'synced' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'synced' },
      { id: 'c', value: 'C', _lastAccessedAt: 3000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    const size = await getCacheSize(STORAGE_KEY, 200);
    expect(size.entryCount).toBe(3);
    expect(size.maxEntries).toBe(200);
    expect(size.nearLimit).toBe(false);
  });

  it('reports nearLimit=true when usage >= 80% of maxEntries', async () => {
    // 8 entries with maxEntries=10 → 80% → nearLimit true.
    const entries: WithMeta<Item>[] = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      value: String(i),
      _lastAccessedAt: i * 1000,
      _syncStatus: 'synced' as const,
    }));
    await seedCacheWithMeta(entries);

    const size = await getCacheSize(STORAGE_KEY, 10);
    expect(size.nearLimit).toBe(true);
  });

  it('reports nearLimit=false when usage < 80% of maxEntries', async () => {
    // 5 entries with maxEntries=10 → 50% → nearLimit false.
    const entries: WithMeta<Item>[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      value: String(i),
      _lastAccessedAt: i * 1000,
      _syncStatus: 'synced' as const,
    }));
    await seedCacheWithMeta(entries);

    const size = await getCacheSize(STORAGE_KEY, 10);
    expect(size.nearLimit).toBe(false);
  });

  it('updates entryCount correctly after eviction', async () => {
    // Start with 4 synced entries, max 2.
    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'A', _lastAccessedAt: 1000, _syncStatus: 'synced' },
      { id: 'b', value: 'B', _lastAccessedAt: 2000, _syncStatus: 'synced' },
      { id: 'c', value: 'C', _lastAccessedAt: 3000, _syncStatus: 'synced' },
      { id: 'd', value: 'D', _lastAccessedAt: 4000, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    await writeBoundedCache<Item>(
      STORAGE_KEY,
      entries.map(({ id, value }) => ({ id, value })),
      2,
    );

    const size = await getCacheSize(STORAGE_KEY, 2);
    expect(size.entryCount).toBe(2);
  });
});

// ─── 6. readBoundedCache strips metadata from callers ────────────────────

describe('readBoundedCache', () => {
  it('strips _lastAccessedAt and _syncStatus from returned entries', async () => {
    const entries: WithMeta<Item>[] = [
      { id: 'a', value: 'Alpha', _lastAccessedAt: 9999, _syncStatus: 'synced' },
    ];
    await seedCacheWithMeta(entries);

    const result = await readBoundedCache<Item>(STORAGE_KEY);
    expect(result).not.toBeNull();
    const entry = result![0] as Item & Partial<WithMeta<Item>>;
    expect(entry._lastAccessedAt).toBeUndefined();
    expect(entry._syncStatus).toBeUndefined();
    expect(entry.id).toBe('a');
    expect(entry.value).toBe('Alpha');
  });

  it('returns null for an empty cache', async () => {
    const result = await readBoundedCache<Item>(STORAGE_KEY);
    expect(result).toBeNull();
  });
});
