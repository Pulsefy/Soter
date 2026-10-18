/**
 * Tests for the storage quota service used by evidence capture (#1160).
 *
 * Acceptance criteria covered:
 *  - available storage is checked before starting a capture (service contract)
 *  - a warning is produced when space is low, before the user proceeds
 *  - the check accounts for the approximate size of pending queued uploads
 *  - verified with simulated low-storage conditions (mocked disk readings)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildStorageWarningMessage,
  formatBytes,
  getPendingUploadBytes,
  getStorageQuotaStatus,
  LOW_STORAGE_THRESHOLD_BYTES,
  StorageQuotaLevel,
} from '../services/storageQuota';

// Mock expo-file-system's native module surface: `Paths.availableDiskSpace`
// and `Paths.totalDiskSpace` are synchronous native getters.
const mockAvailableDiskSpace = jest.fn<number, []>();
const mockTotalDiskSpace = jest.fn<number, []>();

jest.mock('expo-file-system', () => ({
  Paths: {
    get availableDiskSpace() {
      return mockAvailableDiskSpace();
    },
    get totalDiskSpace() {
      return mockTotalDiskSpace();
    },
  },
}));

jest.mock('../services/logger', () => ({
  structuredLogger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const STORAGE_TOTAL = 8 * 1024 * 1024 * 1024; // 8 GB device

// `AsyncStorageStatic.clear` is missing from the installed typings (a known
// repo-wide typing gap); go through an untyped view instead.
const clearAsyncStorage = async (): Promise<void> => {
  await (AsyncStorage as unknown as { clear: () => Promise<void> }).clear();
};

const setFreeDiskBytes = (bytes: number | null) => {
  if (bytes === null) {
    mockAvailableDiskSpace.mockImplementation(() => {
      throw new Error('unavailable');
    });
  } else {
    mockAvailableDiskSpace.mockReturnValue(bytes);
  }
};

const seedSyncQueue = async (
  items: Record<string, unknown>[],
): Promise<void> => {
  await AsyncStorage.setItem('@soter/sync-queue', JSON.stringify(items));
};

describe('storageQuota (#1160)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearAsyncStorage();
    mockTotalDiskSpace.mockReturnValue(STORAGE_TOTAL);
    setFreeDiskBytes(4 * 1024 * 1024 * 1024); // healthy by default
  });

  describe('formatBytes', () => {
    it('formats bytes into human readable units', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
      expect(formatBytes(3.2 * 1024 * 1024 * 1024)).toBe('3.2 GB');
    });
  });

  describe('getPendingUploadBytes', () => {
    it('returns 0 for an empty or absent queue', async () => {
      expect(await getPendingUploadBytes()).toBe(0);
      await AsyncStorage.setItem('@soter/sync-queue', '[]');
      expect(await getPendingUploadBytes()).toBe(0);
    });

    it('sums estimatedSize of pending and retrying evidence uploads', async () => {
      await seedSyncQueue([
        {
          id: 'a',
          type: 'evidence-upload',
          state: 'pending',
          payload: { estimatedSize: 3 * 1024 * 1024 },
        },
        {
          id: 'b',
          type: 'evidence-upload',
          state: 'retrying',
          payload: { estimatedSize: 2 * 1024 * 1024 },
        },
      ]);
      expect(await getPendingUploadBytes()).toBe(5 * 1024 * 1024);
    });

    it('ignores completed (submitted) and non-evidence actions', async () => {
      await seedSyncQueue([
        {
          id: 'done',
          type: 'evidence-upload',
          state: 'submitted',
          payload: { estimatedSize: 9 * 1024 * 1024 },
        },
        {
          id: 'claim',
          type: 'claim-submission',
          state: 'pending',
          payload: { estimatedSize: 9 * 1024 * 1024 },
        },
      ]);
      expect(await getPendingUploadBytes()).toBe(0);
    });

    it('falls back to payload body length when estimatedSize is missing', async () => {
      const body = JSON.stringify({ imageBase64: 'x'.repeat(2048) });
      await seedSyncQueue([
        { id: 'c', type: 'evidence-upload', state: 'pending', payload: { body } },
      ]);
      expect(await getPendingUploadBytes()).toBe(body.length);
    });

    it('treats a malformed queue as zero rather than throwing', async () => {
      await AsyncStorage.setItem('@soter/sync-queue', 'not-json');
      expect(await getPendingUploadBytes()).toBe(0);
    });
  });

  describe('getStorageQuotaStatus', () => {
    it('reports ok when free space is ample and no uploads are pending', async () => {
      const status = await getStorageQuotaStatus();
      expect(status.level).toBe<StorageQuotaLevel>('ok');
      expect(status.readable).toBe(true);
      expect(status.pendingUploadBytes).toBe(0);
      expect(status.effectiveFreeBytes).toBe(4 * 1024 * 1024 * 1024);
    });

    it('subtracts pending queued uploads from free space', async () => {
      setFreeDiskBytes(250 * 1024 * 1024);
      await seedSyncQueue([
        {
          id: 'a',
          type: 'evidence-upload',
          state: 'pending',
          payload: { estimatedSize: 100 * 1024 * 1024 },
        },
      ]);

      const status = await getStorageQuotaStatus();
      expect(status.pendingUploadBytes).toBe(100 * 1024 * 1024);
      expect(status.effectiveFreeBytes).toBe(150 * 1024 * 1024);
      // Without queue accounting this device would look fine (250 MB > 200 MB).
      expect(status.level).toBe<StorageQuotaLevel>('low');
    });

    it('classifies low storage at the absolute threshold (simulated low-storage device)', async () => {
      setFreeDiskBytes(LOW_STORAGE_THRESHOLD_BYTES - 1024);
      const status = await getStorageQuotaStatus();
      expect(status.level).toBe<StorageQuotaLevel>('low');
      expect(buildStorageWarningMessage(status)).toMatch(/Low storage/i);
    });

    it('classifies low storage by ratio on very small simulated volumes', async () => {
      // 4 GB total, 3% free = 120 MB < 200 MB absolute? No — 120 MB < 200 MB is
      // true, so pick a volume where only the ratio trips: 64 GB total, 3% free.
      mockTotalDiskSpace.mockReturnValue(64 * 1024 * 1024 * 1024);
      setFreeDiskBytes(Math.floor(64 * 1024 * 1024 * 1024 * 0.03)); // ~1.9 GB
      const status = await getStorageQuotaStatus();
      expect(status.level).toBe<StorageQuotaLevel>('low');
    });

    it('classifies critical storage when even one capture cannot fit', async () => {
      setFreeDiskBytes(4 * 1024 * 1024); // 4 MB — below capture overhead
      await seedSyncQueue([
        {
          id: 'a',
          type: 'evidence-upload',
          state: 'pending',
          payload: { estimatedSize: 2 * 1024 * 1024 },
        },
      ]);

      const status = await getStorageQuotaStatus();
      expect(status.level).toBe<StorageQuotaLevel>('critical');
      const message = buildStorageWarningMessage(status);
      expect(message).toMatch(/Very low storage/i);
      expect(message).toContain('pending uploads');
    });

    it('degrades gracefully when the disk reading is unavailable', async () => {
      setFreeDiskBytes(null);
      const status = await getStorageQuotaStatus();
      expect(status.readable).toBe(false);
      expect(status.level).toBe<StorageQuotaLevel>('ok');
      // Unreadable storage yields an advisory, never a hard block.
      expect(buildStorageWarningMessage(status)).toMatch(/could not be checked/i);
    });
  });

  describe('buildStorageWarningMessage', () => {
    it('returns null when storage is healthy', async () => {
      const status = await getStorageQuotaStatus();
      expect(buildStorageWarningMessage(status)).toBeNull();
    });
  });
});
