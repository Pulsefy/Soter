import AsyncStorage from '@react-native-async-storage/async-storage';
import { VersionInfo } from '../types/update';
import { config } from '../config';
import { structuredLogger } from './logger';

/** AsyncStorage key holding the last successfully fetched version policy. */
export const VERSION_CACHE_KEY = '@Soter:VersionInfo';

const DEFAULT_RELEASE_NOTES = [
  'Added support for on-chain verification',
  'Improved sync reliability in low-bandwidth areas',
  'Fixed a bug in QR code scanning for legacy NGO cards',
  'Reduced app bundle size by 15%',
];

const DEFAULT_STORE_URL = {
  ios: 'https://apps.apple.com/app/soter',
  android: 'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
};

/**
 * Fetches the latest version policy from the backend.
 * Throws when the endpoint is unreachable or returns a non-OK response so the
 * caller can decide how to behave while offline.
 */
export const fetchVersionInfo = async (): Promise<VersionInfo> => {
  const response = await fetch(
    `${config.apiUrl}/api/v1/config/version?platform=mobile`,
  );
  if (!response.ok) throw new Error('Failed to fetch version info');
  const data = await response.json();
  return {
    latestVersion: data.latestVersion,
    minRequiredVersion: data.minRequiredVersion || data.currentVersion,
    releaseNotes: data.releaseNotes?.changes || data.releaseNotesArray || DEFAULT_RELEASE_NOTES,
    storeUrl: data.storeUrl || DEFAULT_STORE_URL,
    gracePeriodMs: data.gracePeriodMs,
    gracePeriodSeconds: data.gracePeriodSeconds,
    deadline: data.deadline,
    forceUpgradeDeadline: data.forceUpgradeDeadline,
  };
};

/** Persists the last successfully fetched version policy for offline use. */
export const cacheVersionInfo = async (versionInfo: VersionInfo): Promise<void> => {
  try {
    await AsyncStorage.setItem(VERSION_CACHE_KEY, JSON.stringify(versionInfo));
  } catch (error) {
    structuredLogger.warn(
      'updates.version_cache_write_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'updates',
    );
  }
};

/** Loads the cached version policy, or null when none has been stored. */
export const loadCachedVersionInfo = async (): Promise<VersionInfo | null> => {
  try {
    const raw = await AsyncStorage.getItem(VERSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VersionInfo | null;
    if (!parsed || typeof parsed.minRequiredVersion !== 'string') return null;
    return parsed;
  } catch (error) {
    structuredLogger.warn(
      'updates.version_cache_read_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'updates',
    );
    return null;
  }
};

/** AsyncStorage key holding the force-upgrade deadline metadata. */
export const FORCE_UPGRADE_DEADLINE_KEY = '@Soter:ForceUpgradeDeadline';

export interface StoredGraceDeadline {
  minRequiredVersion: string;
  deadline: number;
}

export const getStoredGraceDeadline = async (
  minRequiredVersion: string,
): Promise<number | null> => {
  try {
    const raw = await AsyncStorage.getItem(FORCE_UPGRADE_DEADLINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGraceDeadline;
    if (
      parsed &&
      parsed.minRequiredVersion === minRequiredVersion &&
      typeof parsed.deadline === 'number'
    ) {
      return parsed.deadline;
    }
    return null;
  } catch (error) {
    structuredLogger.warn(
      'updates.grace_deadline_read_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'updates',
    );
    return null;
  }
};

export const setStoredGraceDeadline = async (
  minRequiredVersion: string,
  deadline: number,
): Promise<void> => {
  try {
    const payload: StoredGraceDeadline = { minRequiredVersion, deadline };
    await AsyncStorage.setItem(
      FORCE_UPGRADE_DEADLINE_KEY,
      JSON.stringify(payload),
    );
  } catch (error) {
    structuredLogger.warn(
      'updates.grace_deadline_write_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'updates',
    );
  }
};

export const clearStoredGraceDeadline = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(FORCE_UPGRADE_DEADLINE_KEY);
  } catch (error) {
    structuredLogger.warn(
      'updates.grace_deadline_clear_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'updates',
    );
  }
};

/**
 * Resolves the absolute timestamp (epoch ms) by which the user must upgrade.
 *
 * 1. If versionInfo specifies an explicit deadline string/timestamp, parse and use it.
 * 2. If a duration is configured (in versionInfo or mobile config):
 *    - Check AsyncStorage for an already active deadline for this required version.
 *    - If found, continue using it (so closing/reopening doesn't reset grace).
 *    - If not found, compute now + duration and persist it.
 * 3. If no grace period or deadline is configured, returns null (immediate block).
 */
export const resolveGraceDeadline = async (
  versionInfo: VersionInfo,
  configGracePeriodMs?: number,
  now = Date.now(),
): Promise<number | null> => {
  const explicitRaw = versionInfo.deadline ?? versionInfo.forceUpgradeDeadline;
  if (explicitRaw !== undefined && explicitRaw !== null) {
    const parsed =
      typeof explicitRaw === 'number' ? explicitRaw : Date.parse(String(explicitRaw));
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Check if a deadline was already stored for this version
  const stored = await getStoredGraceDeadline(versionInfo.minRequiredVersion);
  if (stored !== null) {
    return stored;
  }

  const graceDurationMs =
    versionInfo.gracePeriodMs ??
    (versionInfo.gracePeriodSeconds !== undefined
      ? versionInfo.gracePeriodSeconds * 1000
      : undefined) ??
    configGracePeriodMs;

  if (graceDurationMs === undefined || graceDurationMs <= 0) {
    return null;
  }

  const newDeadline = now + graceDurationMs;
  await setStoredGraceDeadline(versionInfo.minRequiredVersion, newDeadline);
  return newDeadline;
};

export type UpgradeState = 'none' | 'warn' | 'block';

export interface UpgradeEvaluation {
  upgradeState: UpgradeState;
  graceDeadline: number | null;
  remainingGraceMs: number;
  isForceUpgrade: boolean;
}

/**
 * Evaluates whether an upgrade is required, and if so, whether the app
 * is currently in a grace period ("warn") or hard blocked ("block").
 */
export const determineUpgradeState = (
  currentVersion: string,
  minRequiredVersion: string,
  deadline: number | null,
  now = Date.now(),
): UpgradeEvaluation => {
  const requiresUpgrade =
    compareVersions(minRequiredVersion, currentVersion) > 0;

  if (!requiresUpgrade) {
    return {
      upgradeState: 'none',
      graceDeadline: null,
      remainingGraceMs: 0,
      isForceUpgrade: false,
    };
  }

  // If no deadline is set, immediate hard block
  if (deadline === null) {
    return {
      upgradeState: 'block',
      graceDeadline: null,
      remainingGraceMs: 0,
      isForceUpgrade: true,
    };
  }

  const remaining = Math.max(0, deadline - now);
  if (remaining > 0) {
    return {
      upgradeState: 'warn',
      graceDeadline: deadline,
      remainingGraceMs: remaining,
      isForceUpgrade: false,
    };
  }

  // Grace period expired: hard block
  return {
    upgradeState: 'block',
    graceDeadline: deadline,
    remainingGraceMs: 0,
    isForceUpgrade: true,
  };
};

/**
 * Formats remaining milliseconds into HH:MM:SS (or MM:SS when < 1 hour).
 */
export const formatGraceCountdown = (remainingMs: number): string => {
  if (remainingMs <= 0) return '00:00';
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
};

export type VersionInfoSource = 'network' | 'cache' | 'none';

export interface ResolvedVersionInfo {
  versionInfo: VersionInfo | null;
  source: VersionInfoSource;
}

/**
 * Resolves the version policy to evaluate against.
 *
 * - Online: fetch fresh data and cache it for later offline use.
 * - Offline with cache: fall back to the last known-good policy so a failed
 *   check never blocks a worker in the field.
 * - Offline without cache: return `none` so the caller can fail open.
 */
export const resolveVersionInfo = async (): Promise<ResolvedVersionInfo> => {
  try {
    const versionInfo = await fetchVersionInfo();
    await cacheVersionInfo(versionInfo);
    return { versionInfo, source: 'network' };
  } catch (error) {
    structuredLogger.error(
      'updates.version_fetch_failed',
      { error: error instanceof Error ? error.message : String(error) },
      'updates',
    );

    const cached = await loadCachedVersionInfo();
    if (cached) {
      return { versionInfo: cached, source: 'cache' };
    }
    return { versionInfo: null, source: 'none' };
  }
};

/**
 * Compares two semantic version strings.
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
export const compareVersions = (v1: string, v2: string): number => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
};

