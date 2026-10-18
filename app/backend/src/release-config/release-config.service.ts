import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ReleaseConfigResponseDto,
  ReleasePlatform,
  ReleaseStoreUrlDto,
} from './dto/release-config.dto';

type ConfigPlatform = 'WEB' | 'MOBILE';

interface PlatformDefaults {
  currentVersion: string;
  latestVersion: string;
  minRequiredVersion: string;
}

const DEFAULT_PLATFORM_CONFIG: Record<ConfigPlatform, PlatformDefaults> = {
  WEB: {
    currentVersion: '1.4.0',
    latestVersion: '1.5.0',
    minRequiredVersion: '1.4.0',
  },
  MOBILE: {
    currentVersion: '1.4.0',
    latestVersion: '1.5.0',
    minRequiredVersion: '1.4.0',
  },
};

const DEFAULT_RELEASE_NOTES = [
  'Improved beneficiary verification',
  'Faster voucher loading',
  'Offline sync improvements',
  'Enhanced security measures',
];

const DEFAULT_IOS_STORE_URL = 'https://apps.apple.com/app/soter';

const DEFAULT_ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile';

@Injectable()
export class ReleaseConfigService {
  constructor(private readonly configService: ConfigService) {}

  getConfig(
    platform: ReleasePlatform = ReleasePlatform.WEB,
  ): ReleaseConfigResponseDto {
    const configPlatform = this.getConfigPlatform(platform);
    const prefix = `RELEASE_${configPlatform}`;
    const defaults = DEFAULT_PLATFORM_CONFIG[configPlatform];

    const latestVersion = this.getString(
      `${prefix}_LATEST_VERSION`,
      defaults.latestVersion,
    );

    const releaseNotes = {
      version: this.getString(`${prefix}_NOTES_VERSION`, latestVersion),
      title: this.getString(`${prefix}_NOTES_TITLE`, "What's New"),
      changes: this.getStringArray(
        `${prefix}_NOTES_CHANGES`,
        DEFAULT_RELEASE_NOTES,
      ),
    };

    return {
      platform,
      currentVersion: this.getString(
        `${prefix}_CURRENT_VERSION`,
        defaults.currentVersion,
      ),
      latestVersion,
      minRequiredVersion: this.getString(
        `${prefix}_MIN_REQUIRED_VERSION`,
        defaults.minRequiredVersion,
      ),
      forceUpgrade: this.getBoolean(`${prefix}_FORCE_UPGRADE`, false),
      releaseNotes,
      releaseNotesArray: [...releaseNotes.changes],
      storeUrl: this.getStoreUrls(platform),
    };
  }

  private getConfigPlatform(platform: ReleasePlatform): ConfigPlatform {
    // iOS and Android are compatibility aliases for mobile configuration.
    return platform === ReleasePlatform.WEB ? 'WEB' : 'MOBILE';
  }

  private getStoreUrls(platform: ReleasePlatform): ReleaseStoreUrlDto {
    const ios = this.getString('RELEASE_IOS_STORE_URL', DEFAULT_IOS_STORE_URL);

    const android = this.getString(
      'RELEASE_ANDROID_STORE_URL',
      DEFAULT_ANDROID_STORE_URL,
    );

    if (platform === ReleasePlatform.IOS) {
      return { ios, android: '' };
    }

    if (platform === ReleasePlatform.ANDROID) {
      return { ios: '', android };
    }

    return { ios, android };
  }

  private getString(key: string, fallback: string): string {
    const value = this.configService.get<string>(key);

    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : fallback;
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const value = this.configService.get<string | boolean>(key);

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return fallback;
    }

    const normalised = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalised)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalised)) {
      return false;
    }

    return fallback;
  }

  private getStringArray(key: string, fallback: string[]): string[] {
    const value = this.configService.get<string | string[]>(key);

    if (Array.isArray(value)) {
      return value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      );
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      return [...fallback];
    }

    try {
      const parsed = JSON.parse(value) as unknown;

      if (
        Array.isArray(parsed) &&
        parsed.every(item => typeof item === 'string')
      ) {
        return parsed;
      }
    } catch {
      return [...fallback];
    }

    return [...fallback];
  }
}
