import { Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { structuredLogger } from './logger';

/**
 * Storage quota checks for evidence capture (#1160).
 *
 * Evidence capture writes a full-resolution photo (and its compressed
 * derivative) to disk before the upload queue drains it, so starting a
 * capture on a nearly-full device can fail partway through and lose the
 * evidence. These helpers let the Evidence Upload screen warn the field
 * worker *before* the capture starts.
 */

/** AsyncStorage key holding the offline sync queue (see `syncQueue.ts`). */
const SYNC_QUEUE_STORAGE_KEY = '@soter/sync-queue';

/**
 * Approximate extra bytes a photo capture needs on top of the media itself
 * (camera temp buffers + the compressed base64 kept in JS memory/disk).
 * Kept deliberately small; the dominant term is the media file itself.
 */
const CAPTURE_OVERHEAD_BYTES = 8 * 1024 * 1024;

/**
 * Free-space fraction below which we warn. Android reserves a small
 * "cached data" allowance that apps cannot rely on, so warning at 5% avoids
 * false "you're fine" results on devices the OS already considers full.
 */
export const LOW_STORAGE_THRESHOLD_BYTES = 200 * 1024 * 1024;
export const LOW_STORAGE_THRESHOLD_RATIO = 0.05;

export type StorageQuotaLevel = 'ok' | 'low' | 'critical';

export interface StorageQuotaStatus {
  /** Best-effort free bytes reported by the OS. */
  freeDiskBytes: number;
  /** Total disk capacity in bytes when the OS reports it, otherwise null. */
  totalDiskBytes: number | null;
  /** Sum of `estimatedSize` (or payload body length) across pending/retrying queued uploads. */
  pendingUploadBytes: number;
  /**
   * Free space that remains after accounting for queued uploads still
   * occupying their local buffers until they finish uploading.
   */
  effectiveFreeBytes: number;
  /** Whether we could read free disk space at all. */
  readable: boolean;
  /** Classification used by the UI: `low` warns, `critical` recommends cleaning up first. */
  level: StorageQuotaLevel;
}

/** Subset of a queued sync action needed to estimate its local footprint. */
interface QueuedUploadLike {
  type?: string;
  state?: string;
  payload?: {
    estimatedSize?: number;
    body?: string;
    [key: string]: unknown;
  };
}

/**
 * Sum of approximate local bytes held by queued evidence uploads that have
 * not finished uploading yet. `state === 'submitted'` entries are already
 * server-confirmed, and completed items are removed from the queue, so they
 * no longer occupy meaningful local space.
 */
export const getPendingUploadBytes = async (): Promise<number> => {
  try {
    const raw = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
    if (!raw) {
      return 0;
    }

    const items = JSON.parse(raw) as QueuedUploadLike[];
    if (!Array.isArray(items)) {
      return 0;
    }

    return items.reduce((total, item) => {
      if (!item || item.type !== 'evidence-upload' || item.state === 'submitted') {
        return total;
      }

      const payload = item.payload ?? {};
      const estimated =
        typeof payload.estimatedSize === 'number' && payload.estimatedSize > 0
          ? payload.estimatedSize
          : typeof payload.body === 'string'
            ? payload.body.length
            : 0;

      return total + estimated;
    }, 0);
  } catch (error) {
    // A malformed queue must never block evidence capture.
    structuredLogger.warn(
      'storage_quota.pending_size_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'storageQuota',
    );
    return 0;
  }
};

/**
 * Read the device's free disk space. Returns `null` when the value is
 * unavailable (web, simulator quirks, permission-less environments) so
 * callers can degrade to a generic advisory instead of a hard block.
 */
export const getFreeDiskBytes = async (): Promise<number | null> => {
  try {
    const available = Paths.availableDiskSpace;
    return typeof available === 'number' && available > 0 && Number.isFinite(available)
      ? available
      : null;
  } catch (error) {
    structuredLogger.warn(
      'storage_quota.free_space_unreadable',
      { error: error instanceof Error ? error.message : String(error) },
      'storageQuota',
    );
    return null;
  }
};

/**
 * Build the full quota status used by the evidence capture flow.
 *
 * `effectiveFreeBytes` subtracts the local footprint of pending queued
 * uploads (criterion 3 of #1160): those bytes are still on disk until their
 * upload completes, so they must not count as available.
 */
export const getStorageQuotaStatus = async (): Promise<StorageQuotaStatus> => {
  const [freeDiskBytes, pendingUploadBytes] = await Promise.all([
    getFreeDiskBytes(),
    getPendingUploadBytes(),
  ]);

  const readable = freeDiskBytes !== null;
  const effectiveFreeBytes = readable
    ? Math.max(0, (freeDiskBytes as number) - pendingUploadBytes)
    : 0;

  let level: StorageQuotaLevel = 'ok';
  if (readable) {
    const belowAbsolute = effectiveFreeBytes <= LOW_STORAGE_THRESHOLD_BYTES;
    const belowRatio =
      Paths.totalDiskSpace > 0 &&
      effectiveFreeBytes <= Paths.totalDiskSpace * LOW_STORAGE_THRESHOLD_RATIO;

    if (belowAbsolute || belowRatio) {
      level = 'low';
    }
    // Consider it critical when even one capture (media + overhead) may not fit.
    if (effectiveFreeBytes < CAPTURE_OVERHEAD_BYTES) {
      level = 'critical';
    }
  }

  return {
    freeDiskBytes: freeDiskBytes ?? 0,
    totalDiskBytes:
      typeof Paths.totalDiskSpace === 'number' && Paths.totalDiskSpace > 0
        ? Paths.totalDiskSpace
        : null,
    pendingUploadBytes,
    effectiveFreeBytes,
    readable,
    level,
  };
};

/**
 * Message shown to the field worker before capture. Kept here (not in the
 * screen) so the wording and thresholds are unit-testable without rendering.
 */
export const buildStorageWarningMessage = (status: StorageQuotaStatus): string | null => {
  if (!status.readable) {
    return 'Device storage could not be checked. If the device is nearly full, capturing evidence may fail and the photo could be lost.';
  }

  if (status.level === 'critical') {
    return `Very low storage: only ${formatBytes(status.effectiveFreeBytes)} free (${formatBytes(
      status.pendingUploadBytes,
    )} is held by pending uploads). Free up space before capturing evidence.`;
  }

  if (status.level === 'low') {
    return `Low storage: about ${formatBytes(status.effectiveFreeBytes)} free after ${formatBytes(
      status.pendingUploadBytes,
    )} for pending uploads. Capture may fail if space runs out.`;
  }

  return null;
};

/** Human-readable byte size, e.g. "1.4 GB" / "380 MB". */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const rounded = value >= 100 || exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;

  return `${rounded} ${units[exponent]}`;
};
