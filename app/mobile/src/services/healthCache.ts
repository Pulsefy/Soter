import AsyncStorage from '@react-native-async-storage/async-storage';
import { HealthStatus } from './api';

const CACHE_KEY = '@soter/health_status';
const CACHE_TIMESTAMP_KEY = '@soter/health_status_timestamp';

/** Persist health status to AsyncStorage */
export const cacheHealthStatus = async (data: HealthStatus): Promise<void> => {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
};

/** Load cached health status from AsyncStorage */
export const loadCachedHealthStatus = async (): Promise<HealthStatus | null> => {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as HealthStatus;
};

/** Returns the ISO timestamp of the last successful health cache write, or null */
export const getHealthCacheTimestamp = async (): Promise<string | null> => {
  const ts = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10)).toISOString();
};

/** Clear the cached health status */
export const clearHealthCache = async (): Promise<void> => {
  await AsyncStorage.multiRemove([CACHE_KEY, CACHE_TIMESTAMP_KEY]);
};
