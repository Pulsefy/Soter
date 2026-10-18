import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClaimStatusHistoryEntryDto {
  @ApiProperty({
    description: 'Previous status the claim transitioned from',
    enum: [
      'requested',
      'verified',
      'approved',
      'disbursed',
      'archived',
      'cancelled',
    ],
    example: 'requested',
    required: false,
  })
  previousStatus?: string;

  @ApiProperty({
    description: 'New status the claim transitioned to',
    enum: [
      'requested',
      'verified',
      'approved',
      'disbursed',
      'archived',
      'cancelled',
    ],
    example: 'verified',
  })
  newStatus: string;

  @ApiProperty({
    description: 'ISO timestamp of the status transition',
    example: '2026-01-15T10:30:00.000Z',
  })
  timestamp: string;

  @ApiPropertyOptional({
    description:
      'Actor ID or trigger source responsible for the transition (e.g., operator ID, system process)',
    example: 'operator-123 or system',
  })
  actor?: string;

  @ApiPropertyOptional({
    description:
      'Trigger type identifying how the transition occurred (e.g., manual_verification, automated_approval, manual_cancellation)',
    example: 'manual_verification',
  })
  trigger?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the transition',
    example: {
      verificationScore: 0.95,
      cancelReasonCode: 'duplicate',
      cancelReason: 'Duplicate claim from same recipient',
    },
  })
  metadata?: Record<string, unknown>;
}

export class ClaimStatusHistoryDto {
  @ApiProperty({
    description: 'Claim ID',
    example: 'claim-uuid-123',
  })
  claimId: string;

  @ApiProperty({
    description:
      'Chronologically ordered status transition history (oldest to newest)',
    type: [ClaimStatusHistoryEntryDto],
  })
  history: ClaimStatusHistoryEntryDto[];

  @ApiProperty({
    description:
      'ISO timestamp of claim creation (beginning of tracked history)',
    example: '2026-01-01T10:00:00.000Z',
  })
  historicalCoverageStart: string;

  @ApiPropertyOptional({
    description:
      'Note on historical coverage. Will be populated if there are gaps in the historical record.',
    example:
      'Complete history available. Status transitions are tracked from claim creation.',
  })
  historicalCoverageNote?: string;
}
