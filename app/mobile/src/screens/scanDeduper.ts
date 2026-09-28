export const SCAN_DEDUPE_WINDOW_MS = 1500;

type Clock = () => number;

export const createScanDeduper = (
  windowMs: number = SCAN_DEDUPE_WINDOW_MS,
  clock: Clock = Date.now,
) => {
  const recentScans = new Map<string, number>();

  return (scanKey: string): boolean => {
    const now = clock();

    for (const [key, timestamp] of recentScans) {
      if (now - timestamp >= windowMs) {
        recentScans.delete(key);
      }
    }

    const previousScan = recentScans.get(scanKey);
    recentScans.set(scanKey, now);

    return previousScan !== undefined && now - previousScan < windowMs;
  };
};