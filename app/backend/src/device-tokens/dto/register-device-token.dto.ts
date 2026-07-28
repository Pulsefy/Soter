import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DevicePlatform } from '@prisma/client';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    enum: DevicePlatform,
    description: 'Platform of the device (iOS or Android).',
    example: DevicePlatform.ios,
  })
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @ApiProperty({
    description: 'Unique device identifier (e.g., UUID from mobile app).',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  deviceId!: string;

  @ApiProperty({
    description: 'Push notification token from APNS/FCM.',
    example: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  token!: string;

  @ApiPropertyOptional({
    description: 'Optional human-readable device name.',
    example: 'iPhone 14 Pro',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;

  @ApiPropertyOptional({
    description: 'App version when token was registered.',
    example: '1.2.3',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
