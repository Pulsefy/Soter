import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config';
import type { QueuedSyncAction } from './syncQueue';

export interface CacheEntryIdentity {
  id: string;
  relatedAidId?: string;
}

export interface CacheBoundsOptions<TItem> {
  cacheKey: string;
  timestampKey: string;
  maxBytes: number;
  warningRatio?: number;
  getIdentity: (item: TItem) => CacheEntryIdentity;
  getEvictionTimestamp: (item: TItem) => number;
}

export interface CacheWriteResult<TItem> {
  items: TItem[];
  sizeBytes: number;
  maxBytes: number;
  evictedCount: number;
  protectedCount: number;
  isOverLimit: boolean;
  isNearLimit: boolean;
}

export interface CacheSummary {
  sizeBytes: number;
  maxBytes: number;
  itemCount: number;
  isOverLimit: boolean;
  isNearLimit: boolean;
  warningRatio: number;
}

export interface LocalCacheSummary {
  aid: CacheSummary;
  task: CacheSummary;
  totalSizeBytes: number;
  totalMaxBytes: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
}

const DEFAULT_WARNING_RATIO = 0.8;
const SYNC_QUEUE_STORAGE_KEY = '@soter/sync-queue';

export const AID_CACHE_KEY = '@soter/aid_overview';
export const AID_CACHE_TIMESTAMP_KEY = '@soter/aid_overview_timestamp';
export const TASK_CACHE_KEY = '@soter/task_list';
export const TASK_CACHE_TIMESTAMP_KEY = '@soter/task_list_timestamp';

const getWarningRatio = (warningRatio?: number) => {
  const ratio = warningRatio ?? config.localCacheWarningRatio ?? DEFAULT_WARNING_RATIO;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    return DEFAULT_WARNING_RATIO;
  }
  return ratio;
};

export const getSerializedSizeBytes = (value: unknown): number => {
  const serialized = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(serialized).length;
  }
  return serialized.length;
};

const getActionAidId = (action: QueuedSyncAction): string | null => {
  const payload = action.payload as { aidId?: unknown };
  return typeof payload.aidId === 'string' ? payload.aidId : null;
};

const isUnsyncedAction = (action: QueuedSyncAction) =>
  action.state !== 'submitted';

export const getUnsyncedAidIds = async (): Promise<Set<string>> => {
  const raw = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
  const items = raw ? (JSON.parse(raw) as QueuedSyncAction[]) : [];
  return new Set(
    items
      .filter(isUnsyncedAction)
      .map(getActionAidId)
      .filter((aidId): aidId is string => Boolean(aidId)),
  );
};

const hasLocalChangeFlag = (item: unknown): boolean => {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const record = item as Record<string, unknown>;
  return (
    record.hasLocalChanges === true ||
    record.localOnly === true ||
    record.dirty === true ||
    record.isDirty === true ||
    record.isSynced === false ||
    record.synced === false ||
    record.syncStatus === 'pending' ||
    record.syncStatus === 'retrying' ||
    record.syncStatus === 'failed' ||
    record.syncStatus === 'conflict'
  );
};

const getProtectedIds = async <TItem>(
  items: TItem[],
  getIdentity: (item: TItem) => CacheEntryIdentity,
): Promise<Set<string>> => {
  const unsyncedAidIds = await getUnsyncedAidIds();
  const protectedIds = new Set<string>();

  items.forEach((item) => {
    const identity = getIdentity(item);
    if (
      hasLocalChangeFlag(item) ||
      unsyncedAidIds.has(identity.id) ||
      (identity.relatedAidId && unsyncedAidIds.has(identity.relatedAidId))
    ) {
      protectedIds.add(identity.id);
    }
  });

  return protectedIds;
};

const buildWriteResult = <TItem>(
  items: TItem[],
  maxBytes: number,
  warningRatio: number,
  evictedCount: number,
  protectedCount: number,
): CacheWriteResult<TItem> => {
  const sizeBytes = getSerializedSizeBytes(items);
  return {
    items,
    sizeBytes,
    maxBytes,
    evictedCount,
    protectedCount,
    isOverLimit: sizeBytes > maxBytes,
    isNearLimit: sizeBytes >= maxBytes * warningRatio,
  };
};

/**
 * Eviction policy: preserve unsynced local changes first, then evict the oldest
 * server-synced records until the serialized cache fits the configured limit.
 * If protected records alone exceed the limit, they are kept and reported over-limit.
 */
export const boundCacheItems = async <TItem>(
  items: TItem[],
  options: Pick<CacheBoundsOptions<TItem>, 'maxBytes' | 'warningRatio' | 'getIdentity' | 'getEvictionTimestamp'>,
): Promise<CacheWriteResult<TItem>> => {
  const warningRatio = getWarningRatio(options.warningRatio);
  const protectedIds = await getProtectedIds(items, options.getIdentity);
  let boundedItems = [...items];
  let evictedCount = 0;

  const evictable = items
    .filter((item) => !protectedIds.has(options.getIdentity(item).id))
    .map((item, index) => ({ item, index, timestamp: options.getEvictionTimestamp(item) }))
    .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);

  for (const candidate of evictable) {
    if (getSerializedSizeBytes(boundedItems) <= options.maxBytes) {
      break;
    }
    const candidateId = options.getIdentity(candidate.item).id;
    boundedItems = boundedItems.filter((item) => options.getIdentity(item).id !== candidateId);
    evictedCount += 1;
  }

  return buildWriteResult(
    boundedItems,
    options.maxBytes,
    warningRatio,
    evictedCount,
    protectedIds.size,
  );
};

export const persistBoundedCache = async <TItem>(
  items: TItem[],
  options: CacheBoundsOptions<TItem>,
): Promise<CacheWriteResult<TItem>> => {
  const result = await boundCacheItems(items, options);
  await AsyncStorage.setItem(options.cacheKey, JSON.stringify(result.items));
  await AsyncStorage.setItem(options.timestampKey, Date.now().toString());
  return result;
};

export const loadCachedItems = async <TItem>(cacheKey: string): Promise<TItem[] | null> => {
  const raw = await AsyncStorage.getItem(cacheKey);
  if (!raw) return null;
  return JSON.parse(raw) as TItem[];
};

export const clearBoundedCache = async <TItem>(
  options: CacheBoundsOptions<TItem>,
): Promise<CacheWriteResult<TItem>> => {
  const current = (await loadCachedItems<TItem>(options.cacheKey)) ?? [];
  const protectedIds = await getProtectedIds(current, options.getIdentity);
  const retained = current.filter((item) => protectedIds.has(options.getIdentity(item).id));

  if (retained.length === 0) {
    await AsyncStorage.multiRemove([options.cacheKey, options.timestampKey]);
  } else {
    await AsyncStorage.setItem(options.cacheKey, JSON.stringify(retained));
    await AsyncStorage.setItem(options.timestampKey, Date.now().toString());
  }

  return buildWriteResult(
    retained,
    options.maxBytes,
    getWarningRatio(options.warningRatio),
    current.length - retained.length,
    protectedIds.size,
  );
};

export const getCacheSummary = async <TItem>(
  options: CacheBoundsOptions<TItem>,
): Promise<CacheSummary> => {
  const items = (await loadCachedItems<TItem>(options.cacheKey)) ?? [];
  const sizeBytes = getSerializedSizeBytes(items);
  const warningRatio = getWarningRatio(options.warningRatio);

  return {
    sizeBytes,
    maxBytes: options.maxBytes,
    itemCount: items.length,
    isOverLimit: sizeBytes > options.maxBytes,
    isNearLimit: sizeBytes >= options.maxBytes * warningRatio,
    warningRatio,
  };
};
