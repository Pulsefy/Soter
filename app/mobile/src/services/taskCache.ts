import AsyncStorage from '@react-native-async-storage/async-storage';
import { TaskItem } from './taskApi';

const CACHE_KEY = '@soter/task_list';
const CACHE_TIMESTAMP_KEY = '@soter/task_list_timestamp';

/** Persist task list to AsyncStorage */
export const cacheTaskList = async (data: TaskItem[]): Promise<void> => {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
};

/** Load cached task list from AsyncStorage */
export const loadCachedTaskList = async (): Promise<TaskItem[] | null> => {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as TaskItem[];
};

/** Returns the ISO timestamp of the last successful cache write, or null */
export const getTaskCacheTimestamp = async (): Promise<string | null> => {
  const ts = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10)).toLocaleString();
};

/** Clear the cached task list */
export const clearTaskCache = async (): Promise<void> => {
  await AsyncStorage.multiRemove([CACHE_KEY, CACHE_TIMESTAMP_KEY]);
};
