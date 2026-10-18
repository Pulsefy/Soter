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
