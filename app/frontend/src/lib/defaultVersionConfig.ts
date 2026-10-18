import type { VersionConfig } from '@/types/version';

export const DEFAULT_VERSION_CONFIG: VersionConfig = {
  platform: 'web',
  currentVersion: '1.4.0',
  latestVersion: '1.5.0',
  minRequiredVersion: '1.4.0',
  forceUpgrade: false,
  releaseNotes: {
    version: '1.5.0',
    title: "What's New",
    changes: [
      'Improved beneficiary verification',
      'Faster voucher loading',
      'Offline sync improvements',
      'Enhanced security measures',
    ],
    changelogUrl: 'https://soter.app/changelog',
    continueLabel: 'Continue',
  },
  forceUpgradeScreen: {
    title: 'Upgrade Required',
    message:
      'A newer version of Soter is required before you can continue using the application.',
    details:
      'This upgrade includes critical security updates and new features required for the platform.',
    updateLabel: 'Update App',
    retryLabel: 'Check Again',
    supportUrl: 'https://soter.app/support',
    supportLabel: 'support page',
  },
  storeUrl: {
    ios: 'https://apps.apple.com/app/soter',
    android:
      'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
    web: 'https://soter.app/download',
  },
};
