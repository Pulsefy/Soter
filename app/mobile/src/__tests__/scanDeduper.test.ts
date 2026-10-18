import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createScanDeduper,
  createScanDeduperSync,
  CROSS_SESSION_DEDUPE_WINDOW_MS,
  SCAN_DEDUPE_WINDOW_MS,
  type DedupeResult,
} from '../screens/scanDeduper';

describe('scanDeduper', () => {
  beforeEach(async () => {
    await (AsyncStorage as typeof AsyncStorage & { clear: () => Promise<void> }).clear();
  });

  describe('createScanDeduperSync (same-session only)', () => {
    it('detects duplicate within window', () => {
      const clock = () => 0;
      const isDuplicate = createScanDeduperSync(1000, clock);

      expect(isDuplicate('pkg-123')).toBe(false);
      expect(isDuplicate('pkg-123')).toBe(true);
    });

    it('does not detect duplicate after window expires', () => {
      let time = 0;
      const clock = () => time;
      const isDuplicate = createScanDeduperSync(1000, clock);

      expect(isDuplicate('pkg-123')).toBe(false);
      time = 500;
      expect(isDuplicate('pkg-123')).toBe(true);
      time = 1500;
      expect(isDuplicate('pkg-123')).toBe(false);
    });

    it('treats different keys as distinct', () => {
      const isDuplicate = createScanDeduperSync(1000, () => 0);

      expect(isDuplicate('pkg-123')).toBe(false);
      expect(isDuplicate('pkg-456')).toBe(false);
      expect(isDuplicate('pkg-123')).toBe(true);
      expect(isDuplicate('pkg-456')).toBe(true);
    });

    it('cleans up expired entries', () => {
      let time = 0;
      const clock = () => time;
      const isDuplicate = createScanDeduperSync(1000, clock);

      isDuplicate('pkg-123');
      isDuplicate('pkg-456');
      time = 500;
      isDuplicate('pkg-789');
      time = 1500;

      // All should be expired
      expect(isDuplicate('pkg-123')).toBe(false);
      expect(isDuplicate('pkg-456')).toBe(false);
      expect(isDuplicate('pkg-789')).toBe(false);
    });
  });

  describe('createScanDeduper (cross-session with persistence)', () => {
    it('detects same-session duplicate with source flag', async () => {
      const clock = () => 0;
      const isDuplicate = await createScanDeduper(1000, 10000, clock);

      const result1 = await isDuplicate('pkg-123');
      expect(result1).toEqual({ isDuplicate: false, source: 'none' });

      const result2 = await isDuplicate('pkg-123');
      expect(result2).toEqual({ isDuplicate: true, source: 'same_session' });
    });

    it('detects cross-session duplicate after persistence', async () => {
      const clock = () => 0;
      const isDuplicate1 = await createScanDeduper(1000, 10000, clock);

      await isDuplicate1('pkg-123');
      const result1 = await isDuplicate1('pkg-123');
      expect(result1.source).toBe('same_session');

      // Simulate app restart by creating new deduper instance
      const isDuplicate2 = await createScanDeduper(1000, 10000, clock);
      const result2 = await isDuplicate2('pkg-123');
      expect(result2).toEqual({ isDuplicate: true, source: 'cross_session' });
    });

    it('does not detect duplicate after retention window expires', async () => {
      let time = 0;
      const clock = () => time;
      const isDuplicate1 = await createScanDeduper(1000, 5000, clock);

      await isDuplicate1('pkg-123');
      time = 6000;

      // New deduper instance (simulating restart after retention window)
      const isDuplicate2 = await createScanDeduper(1000, 5000, clock);
      const result = await isDuplicate2('pkg-123');
      expect(result).toEqual({ isDuplicate: false, source: 'none' });
    });

    it('cleans up expired records on initialization', async () => {
      let time = 0;
      const clock = () => time;

      // Create first session and record scans
      const isDuplicate1 = await createScanDeduper(1000, 5000, clock);
      await isDuplicate1('pkg-123');
      await isDuplicate1('pkg-456');
      await isDuplicate1('pkg-789');

      // Advance time past retention window
      time = 6000;

      // New instance should auto-clean expired records
      const isDuplicate2 = await createScanDeduper(1000, 5000, clock);

      // Verify storage was cleaned BEFORE calling isDuplicate (which would add records back)
      const storageRaw = await AsyncStorage.getItem('@soter/scan_dedup_records');
      const storageRecords = storageRaw ? JSON.parse(storageRaw) : [];
      // Storage should have the cleaned records (empty array)
      expect(Array.isArray(storageRecords)).toBe(true);
      expect(storageRecords).toHaveLength(0);

      const result = await isDuplicate2('pkg-123');
      expect(result).toEqual({ isDuplicate: false, source: 'none' });
    });

    it('treats different keys as distinct across sessions', async () => {
      const clock = () => 0;
      const isDuplicate1 = await createScanDeduper(1000, 10000, clock);

      await isDuplicate1('pkg-123');
      await isDuplicate1('pkg-456');

      const isDuplicate2 = await createScanDeduper(1000, 10000, clock);
      const result1 = await isDuplicate2('pkg-123');
      const result2 = await isDuplicate2('pkg-456');
      const result3 = await isDuplicate2('pkg-789');

      expect(result1).toEqual({ isDuplicate: true, source: 'cross_session' });
      expect(result2).toEqual({ isDuplicate: true, source: 'cross_session' });
      expect(result3).toEqual({ isDuplicate: false, source: 'none' });
    });

    it('prefers same-session detection over cross-session', async () => {
      let time = 0;
      const clock = () => time;
      const isDuplicate = await createScanDeduper(1000, 10000, clock);

      await isDuplicate('pkg-123');
      time = 500;
      const result = await isDuplicate('pkg-123');
      expect(result.source).toBe('same_session');
    });

    it('handles storage errors gracefully', async () => {
      const clock = () => 0;

      // Corrupt storage
      await AsyncStorage.setItem('@soter/scan_dedup_records', 'invalid-json');

      const isDuplicate = await createScanDeduper(1000, 10000, clock);
      const result = await isDuplicate('pkg-123');

      // Should still work, just starting fresh
      expect(result).toEqual({ isDuplicate: false, source: 'none' });
    });

    it('updates timestamp on each scan', async () => {
      let time = 0;
      const clock = () => time;
      const isDuplicate1 = await createScanDeduper(1000, 10000, clock);

      await isDuplicate1('pkg-123');
      time = 2000;
      await isDuplicate1('pkg-123');
      time = 3000;

      // New instance should see the updated timestamp
      const isDuplicate2 = await createScanDeduper(1000, 10000, clock);
      const result = await isDuplicate2('pkg-123');
      expect(result).toEqual({ isDuplicate: true, source: 'cross_session' });
    });

    it('uses default windows when not specified', async () => {
      const clock = () => 0;
      const isDuplicate = await createScanDeduper();

      const result1 = await isDuplicate('pkg-123');
      expect(result1.isDuplicate).toBe(false);

      const result2 = await isDuplicate('pkg-123');
      expect(result2.source).toBe('same_session');
    });
  });

  describe('constants', () => {
    it('has reasonable default values', () => {
      expect(SCAN_DEDUPE_WINDOW_MS).toBe(1500);
      expect(CROSS_SESSION_DEDUPE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    });
  });
});
