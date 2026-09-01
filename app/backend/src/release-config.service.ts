import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Platform = 'web' | 'ios' | 'android';

export interface ReleaseNotesConfig {
  version: string;
  title: string;
  changes: string[];
  changelogUrl: string;
  continueLabel: string;
}

export interface ForceUpgradeConfig {
  title: string;
  message: string;
  details: string;
  updateLabel: string;
  retryLabel: string;
  supportUrl: string;
  supportLabel: string;
}

export interface ReleaseConfigResponse {
  platform: Platform;
  currentVersion: string;
  latestVersion: string;
  minRequiredVersion: string;
  forceUpgrade: boolean;
  releaseNotes: ReleaseNotesConfig;
  forceUpgradeScreen: ForceUpgradeConfig;
  storeUrl: {
    ios: string;
    android: string;
    web: string;
  };
}

const DEFAULT_RELEASE_CONFIG = {
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
} as const;

@Injectable()
export class ReleaseConfigService {
  constructor(private readonly configService: ConfigService) {}

  getConfig(platformInput?: string): ReleaseConfigResponse {
    const platform = this.normalizePlatform(platformInput);
    const envOverride = this.configService.get<string>('RELEASE_CONFIG_JSON');
    const mergedConfig = this.mergeConfig(envOverride);

    return {
      platform,
      currentVersion: mergedConfig.currentVersion,
      latestVersion: mergedConfig.latestVersion,
      minRequiredVersion: mergedConfig.minRequiredVersion,
      forceUpgrade: mergedConfig.forceUpgrade,
      releaseNotes: {
        ...mergedConfig.releaseNotes,
        changes: [...mergedConfig.releaseNotes.changes],
      },
      forceUpgradeScreen: {
        ...mergedConfig.forceUpgradeScreen,
      },
      storeUrl: {
        ios: platform === 'android' ? '' : mergedConfig.storeUrl.ios,
        android: platform === 'ios' ? '' : mergedConfig.storeUrl.android,
        web: mergedConfig.storeUrl.web,
      },
    };
  }

  private normalizePlatform(platform?: string): Platform {
    if (platform === 'ios' || platform === 'android') {
      return platform;
    }

    return 'web';
  }

  private mergeConfig(rawConfig?: string) {
    if (!rawConfig) {
      return DEFAULT_RELEASE_CONFIG;
    }

    try {
      const parsed = JSON.parse(rawConfig) as Partial<
        typeof DEFAULT_RELEASE_CONFIG
      >;

      return {
        ...DEFAULT_RELEASE_CONFIG,
        ...parsed,
        releaseNotes: {
          ...DEFAULT_RELEASE_CONFIG.releaseNotes,
          ...parsed.releaseNotes,
          changes: [
            ...(parsed.releaseNotes?.changes ??
              DEFAULT_RELEASE_CONFIG.releaseNotes.changes),
          ],
        },
        forceUpgradeScreen: {
          ...DEFAULT_RELEASE_CONFIG.forceUpgradeScreen,
          ...parsed.forceUpgradeScreen,
        },
        storeUrl: {
          ...DEFAULT_RELEASE_CONFIG.storeUrl,
          ...parsed.storeUrl,
        },
      };
    } catch {
      return DEFAULT_RELEASE_CONFIG;
    }
  }
}
