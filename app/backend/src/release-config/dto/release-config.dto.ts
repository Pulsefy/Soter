import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ReleasePlatform {
  WEB = 'web',
  MOBILE = 'mobile',
  IOS = 'ios',
  ANDROID = 'android',
}

export class ReleaseConfigQueryDto {
  @ApiPropertyOptional({
    enum: ReleasePlatform,
    default: ReleasePlatform.WEB,
    description:
      'Client platform. iOS and Android use the mobile release configuration.',
  })
  @IsOptional()
  @IsEnum(ReleasePlatform)
  platform?: ReleasePlatform;
}

export class ReleaseNotesDto {
  @ApiProperty({ example: '1.5.0' })
  version!: string;

  @ApiProperty({ example: "What's New" })
  title!: string;

  @ApiProperty({
    type: [String],
    example: ['Improved beneficiary verification', 'Faster voucher loading'],
  })
  changes!: string[];
}

export class ReleaseStoreUrlDto {
  @ApiProperty({ example: 'https://apps.apple.com/app/soter' })
  ios!: string;

  @ApiProperty({
    example:
      'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
  })
  android!: string;
}

export class ReleaseConfigResponseDto {
  @ApiProperty({ enum: ReleasePlatform, example: ReleasePlatform.WEB })
  platform!: ReleasePlatform;

  @ApiProperty({ example: '1.4.0' })
  currentVersion!: string;

  @ApiProperty({ example: '1.5.0' })
  latestVersion!: string;

  @ApiProperty({ example: '1.4.0' })
  minRequiredVersion!: string;

  @ApiProperty({
    example: false,
    description:
      'Backend-managed force-upgrade flag for the selected release configuration.',
  })
  forceUpgrade!: boolean;

  @ApiProperty({ type: ReleaseNotesDto })
  releaseNotes!: ReleaseNotesDto;

  @ApiProperty({
    type: [String],
    deprecated: true,
    description:
      'Compatibility field. New consumers should use releaseNotes.changes.',
  })
  releaseNotesArray!: string[];

  @ApiProperty({ type: ReleaseStoreUrlDto })
  storeUrl!: ReleaseStoreUrlDto;
}
