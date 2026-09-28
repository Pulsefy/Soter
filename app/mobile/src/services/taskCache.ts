import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TaskItem } from './taskApi';
import { config } from '../config';
import {
  TASK_CACHE_KEY,
  TASK_CACHE_TIMESTAMP_KEY,
  clearBoundedCache,
  getCacheSummary,
  loadCachedItems,
  persistBoundedCache,
} from './localCache';
import type { CacheWriteResult } from './localCache';

const taskCacheOptions = {
  cacheKey: TASK_CACHE_KEY,
  timestampKey: TASK_CACHE_TIMESTAMP_KEY,
  maxBytes: config.taskCacheMaxBytes,
  warningRatio: config.localCacheWarningRatio,
  getIdentity: (item: TaskItem) => ({ id: item.id, relatedAidId: item.assignedPackageId }),
  getEvictionTimestamp: (item: TaskItem) => {
    const timestamp = new Date(item.dueDate).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  },
};

/** Persist task list to AsyncStorage */
export const cacheTaskList = async (
  data: TaskItem[],
  maxBytes = config.taskCacheMaxBytes,
): Promise<CacheWriteResult<TaskItem>> =>
  persistBoundedCache(data, { ...taskCacheOptions, maxBytes });

/** Load cached task list from AsyncStorage */
export const loadCachedTaskList = async (): Promise<TaskItem[] | null> =>
  loadCachedItems<TaskItem>(TASK_CACHE_KEY);

/** Returns the ISO timestamp of the last successful cache write, or null */
export const getTaskCacheTimestamp = async (): Promise<string | null> => {
  const ts = await AsyncStorage.getItem(TASK_CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10)).toLocaleString();
};

/** Clear synced cached tasks while preserving unsynced local changes. */
export const clearTaskCache = async () => clearBoundedCache<TaskItem>(taskCacheOptions);

export const getTaskCacheSummary = async () => getCacheSummary<TaskItem>(taskCacheOptions);
