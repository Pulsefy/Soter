import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsEnum,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LockEntityType {
  VERIFICATION = 'verification',
  CLAIM = 'claim',
}

export enum LockResponseCode {
  ACQUIRED = 'LOCK_ACQUIRED',
  ALREADY_LOCKED = 'LOCK_ALREADY_LOCKED',
  NOT_LOCKED = 'NOT_LOCKED',
  EXPIRED = 'LOCK_EXPIRED',
  RELEASED = 'LOCK_RELEASED',
  CONFLICT = 'LOCK_CONFLICT',
  NOT_OWNER = 'NOT_LOCK_OWNER',
}

export class AcquireLockDto {
  @ApiProperty({
    description: 'Type of entity to lock',
    enum: LockEntityType,
    example: LockEntityType.VERIFICATION,
  })
  @IsEnum(LockEntityType)
  entityType: LockEntityType;

  @ApiProperty({
    description: 'ID of the entity to lock',
    example: 'clv789xyz123',
  })
  @IsString()
  @IsNotEmpty()
  entityId: string;

  @ApiPropertyOptional({
    description: 'Lock duration in seconds (default: 300 = 5 minutes)',
    minimum: 30,
    maximum: 3600,
    default: 300,
    example: 300,
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  durationSeconds?: number = 300;
}

export class ReleaseLockDto {
  @ApiProperty({
    description: 'ID of the lock to release',
    example: 'lkabc123xyz',
  })
  @IsString()
  @IsNotEmpty()
  lockId: string;
}

export class RefreshLockDto {
  @ApiProperty({
    description: 'ID of the lock to refresh',
    example: 'lkabc123xyz',
  })
  @IsString()
  @IsNotEmpty()
  lockId: string;

  @ApiPropertyOptional({
    description: 'New duration in seconds (default: current duration)',
    minimum: 30,
    maximum: 3600,
    example: 300,
  })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  durationSeconds?: number;
}

export class LockInfoResponse {
  @ApiProperty({
    description: 'Lock ID',
    example: 'lkabc123xyz',
  })
  lockId: string;

  @ApiProperty({
    description: 'Type of entity locked',
    enum: LockEntityType,
    example: LockEntityType.VERIFICATION,
  })
  entityType: string;

  @ApiProperty({
    description: 'ID of the locked entity',
    example: 'clv789xyz123',
  })
  entityId: string;

  @ApiProperty({
    description: 'User who holds the lock',
    example: 'reviewer-001',
  })
  lockedBy: string;

  @ApiProperty({
    description: 'Timestamp when lock was acquired',
    example: '2025-01-23T14:00:00.000Z',
  })
  lockedAt: string;

  @ApiProperty({
    description: 'Timestamp when lock expires',
    example: '2025-01-23T14:05:00.000Z',
  })
  expiresAt: string;

  @ApiProperty({
    description: 'Current lock status',
    enum: LockResponseCode,
    example: LockResponseCode.ACQUIRED,
  })
  code: LockResponseCode;

  @ApiProperty({
    description: 'Human-readable message',
    example: 'Lock acquired successfully',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Remaining time in seconds (if lock is active)',
    example: 285,
  })
  remainingSeconds?: number;
}

export class LockConflictResponse {
  @ApiProperty({
    description: 'Response code indicating conflict',
    enum: LockResponseCode,
    example: LockResponseCode.ALREADY_LOCKED,
  })
  code: LockResponseCode;

  @ApiProperty({
    description: 'Human-readable conflict message',
    example: 'Verification request is currently locked by another reviewer',
  })
  message: string;

  @ApiProperty({
    description: 'Current lock holder',
    example: 'reviewer-002',
  })
  lockedBy: string;

  @ApiProperty({
    description: 'Timestamp when lock was acquired',
    example: '2025-01-23T14:00:00.000Z',
  })
  lockedAt: string;

  @ApiProperty({
    description: 'Timestamp when lock expires',
    example: '2025-01-23T14:05:00.000Z',
  })
  expiresAt: string;

  @ApiProperty({
    description: 'Remaining time until lock expires',
    example: 285,
  })
  remainingSeconds: number;

  @ApiProperty({
    description: 'Suggested action for frontend',
    example: 'refresh_page',
  })
  suggestedAction: 'refresh_page' | 'try_again_later' | 'force_refresh';
}
