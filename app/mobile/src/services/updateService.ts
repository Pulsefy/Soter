import { VersionInfo } from '../types/update';
import { config } from '../config';

export const fetchVersionInfo = async (): Promise<VersionInfo> => {
  try {
    const response = await fetch(`${config.apiUrl}/api/v1/config/version?platform=mobile`);
    if (!response.ok) throw new Error('Failed to fetch version info');
    const data = await response.json();
    return {
      latestVersion: data.latestVersion,
      minRequiredVersion: data.minRequiredVersion || data.currentVersion,
      releaseNotes: data.releaseNotes?.changes || data.releaseNotesArray || [
        'Added support for on-chain verification',
        'Improved sync reliability in low-bandwidth areas',
        'Fixed a bug in QR code scanning for legacy NGO cards',
        'Reduced app bundle size by 15%',
      ],
      storeUrl: data.storeUrl || {
        ios: 'https://apps.apple.com/app/soter',
        android: 'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
      },
    };
  } catch (error) {
    console.error('UpdateService: Error fetching version info from backend, falling back to mock:', error);
    return {
      latestVersion: '1.1.0',
      minRequiredVersion: '1.0.0',
      releaseNotes: [
        'Added support for on-chain verification',
        'Improved sync reliability in low-bandwidth areas',
        'Fixed a bug in QR code scanning for legacy NGO cards',
        'Reduced app bundle size by 15%',
      ],
      storeUrl: {
        ios: 'https://apps.apple.com/app/soter',
        android: 'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
      },
    };
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
