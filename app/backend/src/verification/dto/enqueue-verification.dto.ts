import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsObject } from 'class-validator';

/**
 * Priority tiers for verification jobs.
 *
 * BullMQ uses lower numeric values as higher priority, so we map named tiers to
 * ascending integers:
 *
 *   urgent (1) → bypasses all backlog; used for demo or reviewer-forced runs
 *   high   (2) → elevated, e.g. flagged by a reviewer for fast-track
 *   normal (3) → default for standard claim submissions
 *   low    (4) → background / bulk-import work that can wait
 *
 * The bound [1, 4] is intentional – callers cannot provide arbitrary integers,
 * which keeps queue ordering predictable and prevents priority inversion.
 */
export enum VerificationPriority {
  URGENT = 1,
  HIGH = 2,
  NORMAL = 3,
  LOW = 4,
}

export const DEFAULT_VERIFICATION_PRIORITY = VerificationPriority.NORMAL;

export class EnqueueVerificationDto {
  @ApiPropertyOptional({
    description:
      'Priority tier for the verification job. ' +
      'urgent (1) bypasses all lower-priority backlog; ' +
      'normal (3) is the default. ' +
      'Bounded to 1–4 to prevent priority inversion.',
    enum: VerificationPriority,
    enumName: 'VerificationPriority',
    example: VerificationPriority.NORMAL,
    default: VerificationPriority.NORMAL,
  })
  @IsOptional()
  @IsEnum(VerificationPriority, {
    message:
      'priority must be one of the supported tiers: 1 (urgent), 2 (high), 3 (normal), 4 (low)',
  })
  priority?: VerificationPriority;

  @ApiPropertyOptional({
    description: 'Optional anchor metadata for AI verification correlation.',
    example: {
      campaignRef: 'CAMPAIGN-001',
      claimId: 'claim-ref-123',
      packageId: 'PKG-456',
    },
  })
  @IsOptional()
  @IsObject()
  anchorMetadata?: {
    campaignRef?: string;
    claimId?: string;
    packageId?: string;
    contractId?: string;
  };
}
