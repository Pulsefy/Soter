import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, VersionConfig, VersionPlatform } from '@prisma/client';
import {
  CreateVersionConfigDto,
  UpdateVersionConfigDto,
  VersionConfigResponseDto,
  PublicVersionConfigResponseDto,
} from './dto/version-config.dto';

@Injectable()
export class VersionConfigService {
  private readonly logger = new Logger(VersionConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new version config record
   */
  async create(dto: CreateVersionConfigDto): Promise<VersionConfigResponseDto> {
    this.logger.log(`Creating version config for platform: ${dto.platform}`);

    const config = await this.prisma.versionConfig.create({
      data: {
        platform: dto.platform,
        currentVersion: dto.currentVersion,
        latestVersion: dto.latestVersion,
        minRequiredVersion: dto.minRequiredVersion,
        forceUpgrade: dto.forceUpgrade,
        releaseNotes: (dto.releaseNotes as Prisma.InputJsonValue) ?? null,
        iosStoreUrl: dto.iosStoreUrl ?? null,
        androidStoreUrl: dto.androidStoreUrl ?? null,
      },
    });

    return this.mapToResponse(config);
  }

  /**
   * Get all version configs
   */
  async findAll(): Promise<VersionConfigResponseDto[]> {
    this.logger.log('Fetching all version configs');
    const configs = await this.prisma.versionConfig.findMany({
      orderBy: { platform: 'asc' },
    });
    return configs.map(config => this.mapToResponse(config));
  }

  /**
   * Get version config by platform
   */
  async findByPlatform(
    platform: string,
  ): Promise<VersionConfigResponseDto | null> {
    this.logger.log(`Fetching version config for platform: ${platform}`);
    const config = await this.prisma.versionConfig.findUnique({
      where: { platform: platform as VersionPlatform },
    });
    return config ? this.mapToResponse(config) : null;
  }

  /**
   * Get public version config by platform (for client consumption)
   */
  async findPublicByPlatform(
    platform: string,
  ): Promise<PublicVersionConfigResponseDto> {
    this.logger.log(`Fetching public version config for platform: ${platform}`);

    const config = await this.prisma.versionConfig.findUnique({
      where: { platform: platform as VersionPlatform },
    });

    if (!config) {
      // Return default config if not found
      return this.getDefaultPublicConfig(platform);
    }

    const releaseNotes = config.releaseNotes as {
      version?: string;
      title?: string;
      changes?: string[];
    } | null;

    return {
      platform: config.platform,
      currentVersion: config.currentVersion,
      latestVersion: config.latestVersion,
      minRequiredVersion: config.minRequiredVersion,
      forceUpgrade: config.forceUpgrade,
      releaseNotes: releaseNotes
        ? {
            version: releaseNotes.version || config.latestVersion,
            title: releaseNotes.title || "What's New",
            changes: releaseNotes.changes || [],
          }
        : undefined,
      releaseNotesArray: releaseNotes?.changes || [],
      storeUrl: {
        ios: config.iosStoreUrl || undefined,
        android: config.androidStoreUrl || undefined,
      },
    };
  }

  /**
   * Update version config
   */
  async update(
    id: string,
    dto: UpdateVersionConfigDto,
  ): Promise<VersionConfigResponseDto> {
    this.logger.log(`Updating version config ${id}`);

    const config = await this.prisma.versionConfig.update({
      where: { id },
      data: {
        currentVersion: dto.currentVersion,
        latestVersion: dto.latestVersion,
        minRequiredVersion: dto.minRequiredVersion,
        forceUpgrade: dto.forceUpgrade,
        releaseNotes:
          dto.releaseNotes !== undefined
            ? (dto.releaseNotes as Prisma.InputJsonValue)
            : undefined,
        iosStoreUrl: dto.iosStoreUrl,
        androidStoreUrl: dto.androidStoreUrl,
      },
    });

    return this.mapToResponse(config);
  }

  /**
   * Delete version config
   */
  async delete(id: string): Promise<void> {
    this.logger.log(`Deleting version config ${id}`);
    await this.prisma.versionConfig.delete({
      where: { id },
    });
  }

  /**
   * Map Prisma model to response DTO
   */
  private mapToResponse(config: VersionConfig): VersionConfigResponseDto {
    return {
      id: config.id,
      platform: config.platform,
      currentVersion: config.currentVersion,
      latestVersion: config.latestVersion,
      minRequiredVersion: config.minRequiredVersion,
      forceUpgrade: config.forceUpgrade,
      releaseNotes: config.releaseNotes as Record<string, unknown> | null,
      iosStoreUrl: config.iosStoreUrl,
      androidStoreUrl: config.androidStoreUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  /**
   * Get default public config when no database config exists
   */
  private getDefaultPublicConfig(
    platform: string,
  ): PublicVersionConfigResponseDto {
    const storeUrl =
      platform === 'ios'
        ? { ios: 'https://apps.apple.com/app/soter', android: '' }
        : platform === 'android'
          ? {
              ios: '',
              android:
                'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
            }
          : {
              ios: 'https://apps.apple.com/app/soter',
              android:
                'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
            };

    return {
      platform,
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
      },
      releaseNotesArray: [
        'Improved beneficiary verification',
        'Faster voucher loading',
        'Offline sync improvements',
        'Enhanced security measures',
      ],
      storeUrl,
    };
  }
}
