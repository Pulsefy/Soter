import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  IsBoolean,
  IsOptional,
  IsObject,
} from 'class-validator';
import { VersionPlatform } from '@prisma/client';

export { VersionPlatform };

export class CreateVersionConfigDto {
  @ApiProperty({
    enum: VersionPlatform,
    description: 'Platform (web, ios, android)',
  })
  @IsEnum(VersionPlatform)
  platform: VersionPlatform;

  @ApiProperty({ description: 'Currently deployed version' })
  @IsString()
  currentVersion: string;

  @ApiProperty({ description: 'Latest available version' })
  @IsString()
  latestVersion: string;

  @ApiProperty({ description: 'Minimum version required to function' })
  @IsString()
  minRequiredVersion: string;

  @ApiProperty({ description: 'Force upgrade flag', default: false })
  @IsBoolean()
  forceUpgrade: boolean;

  @ApiPropertyOptional({
    description: 'Release notes (JSON with version, title, changes)',
    example: {
      version: '1.5.0',
      title: "What's New",
      changes: ['Improved beneficiary verification', 'Faster voucher loading'],
    },
  })
  @IsOptional()
  @IsObject()
  releaseNotes?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'App Store URL for iOS' })
  @IsOptional()
  @IsString()
  iosStoreUrl?: string;

  @ApiPropertyOptional({ description: 'Play Store URL for Android' })
  @IsOptional()
  @IsString()
  androidStoreUrl?: string;
}

export class UpdateVersionConfigDto {
  @ApiPropertyOptional({ description: 'Currently deployed version' })
  @IsOptional()
  @IsString()
  currentVersion?: string;

  @ApiPropertyOptional({ description: 'Latest available version' })
  @IsOptional()
  @IsString()
  latestVersion?: string;

  @ApiPropertyOptional({ description: 'Minimum version required to function' })
  @IsOptional()
  @IsString()
  minRequiredVersion?: string;

  @ApiPropertyOptional({ description: 'Force upgrade flag' })
  @IsOptional()
  @IsBoolean()
  forceUpgrade?: boolean;

  @ApiPropertyOptional({
    description: 'Release notes (JSON with version, title, changes)',
  })
  @IsOptional()
  @IsObject()
  releaseNotes?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'App Store URL for iOS' })
  @IsOptional()
  @IsString()
  iosStoreUrl?: string;

  @ApiPropertyOptional({ description: 'Play Store URL for Android' })
  @IsOptional()
  @IsString()
  androidStoreUrl?: string;
}

export class VersionConfigResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: VersionPlatform })
  platform: VersionPlatform;

  @ApiProperty()
  currentVersion: string;

  @ApiProperty()
  latestVersion: string;

  @ApiProperty()
  minRequiredVersion: string;

  @ApiProperty()
  forceUpgrade: boolean;

  @ApiPropertyOptional()
  releaseNotes?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  iosStoreUrl?: string | null;

  @ApiPropertyOptional()
  androidStoreUrl?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PublicVersionConfigResponseDto {
  @ApiProperty()
  platform: string;

  @ApiProperty()
  currentVersion: string;

  @ApiProperty()
  latestVersion: string;

  @ApiProperty()
  minRequiredVersion: string;

  @ApiProperty()
  forceUpgrade: boolean;

  @ApiPropertyOptional()
  releaseNotes?: {
    version: string;
    title: string;
    changes: string[];
  };

  @ApiPropertyOptional()
  releaseNotesArray?: string[];

  @ApiProperty()
  storeUrl: {
    ios?: string;
    android?: string;
  };
}
