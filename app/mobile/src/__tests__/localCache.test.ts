import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AidPackage } from '../services/api';
import type { TaskItem } from '../services/taskApi';
import { cacheAidList, clearAidCache, loadCachedAidList } from '../services/aidCache';
import { cacheTaskList, loadCachedTaskList } from '../services/taskCache';
import { AID_CACHE_KEY, getSerializedSizeBytes } from '../services/localCache';
import type { QueuedSyncAction } from '../services/syncQueue';

const QUEUE_KEY = '@soter/sync-queue';

const makeAid = (id: string, date: string, padding = 'x'.repeat(80)): AidPackage => ({
  id,
  title: `Aid ${id} ${padding}`,
  amount: 10,
  status: 'active',
  date,
});

const makeTask = (id: string, assignedPackageId: string, dueDate: string): TaskItem => ({
  id,
  title: `Task ${id} ${'x'.repeat(80)}`,
  assignedPackageId,
  dueDate,
  dueState: 'upcoming',
  status: 'pending',
});

const queuedActionForAid = (aidId: string): QueuedSyncAction => ({
  id: `queue-${aidId}`,
  type: 'evidence-upload',
  payload: { aidId, url: 'https://example.test/upload', body: '{}' },
  state: 'pending',
  retryCount: 0,
  maxRetries: 5,
  nextRetryAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastError: null,
});

describe('bounded local caches', () => {
  beforeEach(async () => {
    await (AsyncStorage as typeof AsyncStorage & { clear: () => Promise<void> }).clear();
  });

  it('evicts the oldest aid records first until the cache fits', async () => {
    const aid = [
      makeAid('oldest', '2026-01-01T00:00:00.000Z'),
      makeAid('middle', '2026-02-01T00:00:00.000Z'),
      makeAid('newest', '2026-03-01T00:00:00.000Z'),
    ];
    const maxBytes = getSerializedSizeBytes([aid[1], aid[2]]) + 2;

    const result = await cacheAidList(aid, maxBytes);
    const cached = await loadCachedAidList();

    expect(result.evictedCount).toBe(1);
    expect(result.sizeBytes).toBeLessThanOrEqual(maxBytes);
    expect(cached?.map((item) => item.id)).toEqual(['middle', 'newest']);
  });

  it('preserves aid records with unsynced local queue actions even when over limit', async () => {
    const aid = [
      makeAid('oldest', '2026-01-01T00:00:00.000Z'),
      makeAid('protected', '2026-01-02T00:00:00.000Z', 'x'.repeat(220)),
      makeAid('newest', '2026-01-03T00:00:00.000Z'),
    ];
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([queuedActionForAid('protected')]));
    const maxBytes = getSerializedSizeBytes([aid[1]]) - 10;

    const result = await cacheAidList(aid, maxBytes);
    const cached = await loadCachedAidList();

    expect(result.protectedCount).toBe(1);
    expect(result.isOverLimit).toBe(true);
    expect(cached?.map((item) => item.id)).toEqual(['protected']);
  });

  it('preserves tasks assigned to aid with unsynced local queue actions', async () => {
    const tasks = [
      makeTask('old-task', 'old-aid', '2026-01-01T00:00:00.000Z'),
      makeTask('protected-task', 'protected-aid', '2026-01-02T00:00:00.000Z'),
      makeTask('new-task', 'new-aid', '2026-01-03T00:00:00.000Z'),
    ];
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([queuedActionForAid('protected-aid')]));
    const maxBytes = getSerializedSizeBytes([tasks[1]]) - 10;

    const result = await cacheTaskList(tasks, maxBytes);
    const cached = await loadCachedTaskList();

    expect(result.protectedCount).toBe(1);
    expect(result.isOverLimit).toBe(true);
    expect(cached?.map((item) => item.id)).toEqual(['protected-task']);
  });

  it('manual clear removes synced cache records but retains unsynced records', async () => {
    const aid = [
      makeAid('synced', '2026-01-01T00:00:00.000Z'),
      makeAid('protected', '2026-01-02T00:00:00.000Z'),
    ];
    await AsyncStorage.setItem(AID_CACHE_KEY, JSON.stringify(aid));
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([queuedActionForAid('protected')]));

    const result = await clearAidCache();
    const cached = await loadCachedAidList();

    expect(result.evictedCount).toBe(1);
    expect(cached?.map((item) => item.id)).toEqual(['protected']);
  });
});
