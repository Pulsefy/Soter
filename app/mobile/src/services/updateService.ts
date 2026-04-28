import { VersionInfo } from '../types/update';

// In a real app, this would be a URL to your backend or a config file (e.g., hosted on GitHub or S3)
const VERSION_CONFIG_URL = 'https://api.pulsefy.org/soter/mobile/version';

export const fetchVersionInfo = async (): Promise<VersionInfo> => {
  try {
    // For now, we'll return mock data. 
    // In production, uncomment the fetch block.
    /*
    const response = await fetch(VERSION_CONFIG_URL);
    if (!response.ok) throw new Error('Failed to fetch version info');
    return await response.json();
    */

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 800));

    return {
      latestVersion: '1.1.0',
      minRequiredVersion: '1.0.0', // Set to something higher than current to test force upgrade
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
  } catch (error) {
    console.error('UpdateService: Error fetching version info', error);
    throw error;
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
