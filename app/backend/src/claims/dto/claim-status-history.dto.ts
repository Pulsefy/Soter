import { ApiProperty } from '@nestjs/swagger';
import { ClaimStatus } from '@prisma/client';

export class ClaimStatusHistoryItemDto {
  @ApiProperty({
    description: 'Unique identifier of the history record',
    example: 'csh_123456789',
  })
  id!: string;

  @ApiProperty({
    description: 'Claim ID associated with this status transition',
    example: 'claim_123',
  })
  claimId!: string;

  @ApiProperty({
    description: 'Previous status before the transition, or null for initial creation',
    enum: ClaimStatus,
    nullable: true,
  })
  fromStatus!: ClaimStatus | null;

  @ApiProperty({
    description: 'New status resulting from the transition',
    enum: ClaimStatus,
  })
  toStatus!: ClaimStatus;

  @ApiProperty({
    description: 'User, system process, or service that triggered the status transition',
    example: 'admin',
  })
  triggeredBy!: string;

  @ApiProperty({
    description: 'Category of trigger: system, admin, operator, verification_result, user',
    example: 'admin',
  })
  triggerType!: string;

  @ApiProperty({
    description: 'Optional reason or note describing the transition',
    nullable: true,
  })
  reason?: string | null;

  @ApiProperty({
    description: 'Timestamp when the transition occurred',
  })
  timestamp!: Date;

  @ApiProperty({
    description: 'Additional metadata associated with the transition',
    nullable: true,
  })
  metadata?: Record<string, any> | null;
}

export class ClaimStatusHistoryResponseDto {
  @ApiProperty({
    description: 'Claim ID',
    example: 'claim_123',
  })
  claimId!: string;

  @ApiProperty({
    description: 'Current status of the claim',
    enum: ClaimStatus,
  })
  currentStatus!: ClaimStatus;

  @ApiProperty({
    description: 'Chronologically ordered list of status transitions',
    type: [ClaimStatusHistoryItemDto],
  })
  history!: ClaimStatusHistoryItemDto[];

  @ApiProperty({
    description: 'Indicates if history tracking is enabled and backfilled',
    example: false,
  })
  historyStartsFromDeployment!: boolean;
}
