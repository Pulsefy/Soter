import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AidPackage } from './api';
import { config } from '../config';
import {
  AID_CACHE_KEY,
  AID_CACHE_TIMESTAMP_KEY,
  clearBoundedCache,
  getCacheSummary,
  loadCachedItems,
  persistBoundedCache,
} from './localCache';
import type { CacheWriteResult } from './localCache';

const aidCacheOptions = {
  cacheKey: AID_CACHE_KEY,
  timestampKey: AID_CACHE_TIMESTAMP_KEY,
  maxBytes: config.aidCacheMaxBytes,
  warningRatio: config.localCacheWarningRatio,
  getIdentity: (item: AidPackage) => ({ id: item.id }),
  getEvictionTimestamp: (item: AidPackage) => {
    const timestamp = new Date(item.date).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  },
};

/** Persist aid list to AsyncStorage */
export const cacheAidList = async (
  data: AidPackage[],
  maxBytes = config.aidCacheMaxBytes,
): Promise<CacheWriteResult<AidPackage>> =>
  persistBoundedCache(data, { ...aidCacheOptions, maxBytes });

/** Load cached aid list from AsyncStorage */
export const loadCachedAidList = async (): Promise<AidPackage[] | null> =>
  loadCachedItems<AidPackage>(AID_CACHE_KEY);

/** Returns the ISO timestamp of the last successful cache write, or null */
export const getCacheTimestamp = async (): Promise<string | null> => {
  const ts = await AsyncStorage.getItem(AID_CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10)).toLocaleString();
};

/** Clear synced cached aid records while preserving unsynced local changes. */
export const clearAidCache = async () => clearBoundedCache<AidPackage>(aidCacheOptions);

export const getAidCacheSummary = async () => getCacheSummary<AidPackage>(aidCacheOptions);
