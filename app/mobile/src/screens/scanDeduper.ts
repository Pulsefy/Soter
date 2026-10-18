import AsyncStorage from '@react-native-async-storage/async-storage';

export const SCAN_DEDUPE_WINDOW_MS = 1500;
export const CROSS_SESSION_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours default

const STORAGE_KEY = '@soter/scan_dedup_records';

type Clock = () => number;

export interface DedupeResult {
  isDuplicate: boolean;
  source: 'none' | 'same_session' | 'cross_session';
}

interface ScanRecord {
  key: string;
  timestamp: number;
}

/**
 * Load persisted scan records from AsyncStorage and clean up expired entries.
 */
async function loadPersistedRecords(
  retentionWindowMs: number,
  clock: Clock,
): Promise<Map<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();

    const records: ScanRecord[] = JSON.parse(raw);
    const now = clock();
    const validRecords = new Map<string, number>();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (now - record.timestamp < retentionWindowMs) {
        validRecords.set(record.key, record.timestamp);
      }
    }

    // Update storage with only valid records
    if (validRecords.size !== records.length) {
      await persistRecords(validRecords);
    }

    return validRecords;
  } catch {
    // If storage fails, start fresh
    return new Map();
  }
}

/**
 * Persist scan records to AsyncStorage.
 */
async function persistRecords(records: Map<string, number>): Promise<void> {
  try {
    const entries: [string, number][] = [];
    records.forEach((timestamp, key) => {
      entries.push([key, timestamp]);
    });
    const scanRecords: ScanRecord[] = entries.map(([key, timestamp]) => ({
      key,
      timestamp,
    }));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(scanRecords));
  } catch {
    // Silently fail - deduplication will degrade to in-memory only
  }
}

/**
 * Clean up expired records from both in-memory and persistent storage.
 */
function cleanupExpiredRecords(
  recentScans: Map<string, number>,
  persistedScans: Map<string, number>,
  windowMs: number,
  retentionWindowMs: number,
  clock: Clock,
): void {
  const now = clock();

  // Clean same-session records
  recentScans.forEach((timestamp, key) => {
    if (now - timestamp >= windowMs) {
      recentScans.delete(key);
    }
  });

  // Clean cross-session records
  persistedScans.forEach((timestamp, key) => {
    if (now - timestamp >= retentionWindowMs) {
      persistedScans.delete(key);
    }
  });
}

export const createScanDeduper = async (
  windowMs: number = SCAN_DEDUPE_WINDOW_MS,
  retentionWindowMs: number = CROSS_SESSION_DEDUPE_WINDOW_MS,
  clock: Clock = Date.now,
): Promise<(scanKey: string) => Promise<DedupeResult>> => {
  const recentScans = new Map<string, number>();
  const persistedScans = await loadPersistedRecords(retentionWindowMs, clock);

  return async (scanKey: string): Promise<DedupeResult> => {
    const now = clock();

    cleanupExpiredRecords(recentScans, persistedScans, windowMs, retentionWindowMs, clock);

    const sameSessionTimestamp = recentScans.get(scanKey);
    const crossSessionTimestamp = persistedScans.get(scanKey);

    // Update both stores
    recentScans.set(scanKey, now);
    persistedScans.set(scanKey, now);
    await persistRecords(persistedScans);

    // Determine deduplication result
    if (sameSessionTimestamp !== undefined && now - sameSessionTimestamp < windowMs) {
      return { isDuplicate: true, source: 'same_session' };
    }

    if (crossSessionTimestamp !== undefined && now - crossSessionTimestamp < retentionWindowMs) {
      return { isDuplicate: true, source: 'cross_session' };
    }

    return { isDuplicate: false, source: 'none' };
  };
};

/**
 * Synchronous version of createScanDeduper for backward compatibility.
 * Only supports same-session deduplication (no persistence).
 */
export const createScanDeduperSync = (
  windowMs: number = SCAN_DEDUPE_WINDOW_MS,
  clock: Clock = Date.now,
) => {
  const recentScans = new Map<string, number>();

  return (scanKey: string): boolean => {
    const now = clock();

    recentScans.forEach((timestamp, key) => {
      if (now - timestamp >= windowMs) {
        recentScans.delete(key);
      }
    });

    const previousScan = recentScans.get(scanKey);
    recentScans.set(scanKey, now);

    return previousScan !== undefined && now - previousScan < windowMs;
  };
};