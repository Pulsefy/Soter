import AsyncStorage from '@react-native-async-storage/async-storage';
import { AidPackage } from './api';

const CACHE_KEY = '@soter/aid_overview';
const CACHE_TIMESTAMP_KEY = '@soter/aid_overview_timestamp';

/** Persist aid list to AsyncStorage */
export const cacheAidList = async (data: AidPackage[]): Promise<void> => {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
};

/** Load cached aid list from AsyncStorage */
export const loadCachedAidList = async (): Promise<AidPackage[] | null> => {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as AidPackage[];
};

/** Returns the ISO timestamp of the last successful cache write, or null */
export const getCacheTimestamp = async (): Promise<string | null> => {
  const ts = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10)).toLocaleString();
};

/** Clear the cached aid list */
export const clearAidCache = async (): Promise<void> => {
  await AsyncStorage.multiRemove([CACHE_KEY, CACHE_TIMESTAMP_KEY]);
};
