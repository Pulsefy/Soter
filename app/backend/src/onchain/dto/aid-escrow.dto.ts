import { IsString, IsOptional, IsNumber, IsArray, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * DTO for creating a single aid package
 */
export class CreateAidPackageDto {
  @ApiProperty({
    description: 'Unique identifier for the package',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;

  @ApiProperty({
    description: 'Stellar address of the aid recipient',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
  })
  @IsString()
  recipientAddress: string;

  @ApiProperty({
    description: 'Amount in stroops (i128 as string to preserve precision)',
    example: '1000000000',
  })
  @IsString()
  amount: string;

  @ApiProperty({
    description: 'Stellar token address',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsString()
  tokenAddress: string;

  @ApiProperty({
    description: 'Unix timestamp when the package expires',
    example: 1704067200,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expiresAt: number;

  @ApiProperty({
    description: 'Optional metadata as key-value pairs',
    example: { campaign_ref: 'campaign-123', region: 'LATAM' },
    required: false,
  })
  @IsOptional()
  metadata?: Record<string, string>;
}

export class DryRunFeePreviewDto {
  @ApiProperty({
    description: 'Configured percentage used to estimate issuance fees',
    example: '0',
  })
  feePercentage: string;

  @ApiProperty({
    description: 'Configured maximum fee cap',
    example: '0',
  })
  maxFee: string;

  @ApiProperty({
    description: 'Estimated fee amount after applying the cap',
    example: '0',
  })
  estimatedFee: string;

  @ApiProperty({
    description: 'Requested package amount plus the estimated fee',
    example: '1000000000',
  })
  totalEstimatedDebit: string;
}

export class DryRunValidationErrorDto {
  @ApiProperty({
    description: 'Input field or validation domain that failed',
    example: 'amount',
  })
  field: string;

  @ApiProperty({
    description: 'Human-readable validation error',
    example: 'Amount must be a positive integer string',
  })
  message: string;
}

export class DryRunExpectedEventDto {
  @ApiProperty({
    description: 'Expected contract event topic',
    example: 'package_created',
  })
  topic: string;

  @ApiProperty({
    description: 'Expected event payload',
    example: {
      package_id: 'pkg_123456789',
      recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      amount: '1000000000',
      actor: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      timestamp: '<ledger close time>',
    },
  })
  payload: Record<string, string>;
}

export class DryRunAidPackageResultDto {
  @ApiProperty({
    description: 'Whether all dry-run validations passed',
    example: true,
  })
  valid: boolean;

  @ApiProperty({
    description: 'Dry-run status. No transaction is submitted.',
    example: 'dry_run',
  })
  status: 'dry_run';

  @ApiProperty({
    description: 'Package ID that would be issued',
    example: 'pkg_123456789',
  })
  packageId: string;

  @ApiProperty({ type: DryRunFeePreviewDto })
  fees: DryRunFeePreviewDto;

  @ApiProperty({ type: [DryRunExpectedEventDto] })
  expectedEvents: DryRunExpectedEventDto[];

  @ApiProperty({ type: [DryRunValidationErrorDto] })
  validationErrors: DryRunValidationErrorDto[];

  @ApiProperty({
    description: 'Timestamp when the dry run was generated',
    example: '2026-03-30T12:30:00.000Z',
  })
  timestamp: Date;

  @ApiProperty({
    description: 'Additional non-mutating simulation metadata',
    example: {
      operatorAddress:
        'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      tokenAddress: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
      stateChanges: false,
    },
  })
  metadata: Record<string, any>;
}

/**
 * DTO for batch creating aid packages
 */
export class BatchCreateAidPackagesDto {
  @ApiProperty({
    description: 'Array of recipient Stellar addresses',
    example: [
      'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47EL5QRUVLYEK2OOABEXVR5CV7',
    ],
  })
  @IsArray()
  @IsString({ each: true })
  recipientAddresses: string[];

  @ApiProperty({
    description: 'Array of amounts (in stroops, as strings)',
    example: ['1000000000', '500000000'],
  })
  @IsArray()
  @IsString({ each: true })
  amounts: string[];

  @ApiProperty({
    description: 'Stellar token address',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsString()
  tokenAddress: string;

  @ApiProperty({
    description: 'Duration in seconds from now until expiration',
    example: 2592000, // 30 days
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expiresIn: number;

  @ApiProperty({
    description: 'Optional metadata as key-value pairs',
    required: false,
  })
  @IsOptional()
  metadata?: Record<string, string>;
}

/**
 * DTO for claiming an aid package
 */
export class ClaimAidPackageDto {
  @ApiProperty({
    description: 'Package ID to claim',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;

  @ApiProperty({
    description: 'Optional amount to claim (for partial/tranche claims)',
    example: '500000000',
    required: false,
  })
  @IsString()
  @IsOptional()
  amount?: string;
}

/**
 * DTO for disbursing an aid package
 */
export class DisburseAidPackageDto {
  @ApiProperty({
    description: 'Package ID to disburse',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;
}

/**
 * DTO for retrieving aid package details
 */
export class GetAidPackageDto {
  @ApiProperty({
    description: 'Package ID to retrieve',
    example: 'pkg_123456789',
  })
  @IsString()
  packageId: string;
}

/**
 * DTO for retrieving aggregated package statistics
 */
export class GetAidPackageStatsDto {
  @ApiProperty({
    description: 'Token address for which to retrieve statistics',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsString()
  tokenAddress: string;
}

/**
 * DTO for extending the expiry of an aid package.
 * Follows the canonical absolute timestamp convention (`newExpiresAt`).
 */
export class ExtendAidPackageExpiryDto {
  @ApiProperty({
    description:
      'New unix timestamp (in seconds) when the package expires. Must be strictly greater than current expiration timestamp.',
    example: 1735689600,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  newExpiresAt: number;
}

// --- Delegate lifecycle DTOs ---

/**
 * DTO for assigning (or updating) a delegate for a package.
 * Use `expiresAt` to create a time-limited delegation; omit it for a
 * permanent delegation (until explicitly revoked).
 */
export class SetDelegateDto {
  @ApiProperty({
    description: 'Stellar address of the delegate who may claim on behalf of the recipient',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
  })
  @IsString()
  delegateAddress: string;

  @ApiProperty({
    description:
      'Optional unix timestamp (seconds) when the delegation expires. Omit or pass 0 for no expiry.',
    example: 1735689600,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expiresAt?: number;
}

/**
 * Response shape for a set-delegate operation.
 */
export class SetDelegateResponseDto {
  @ApiProperty({ description: 'Package ID the delegate was assigned to', example: 'pkg_123456789' })
  packageId: string;

  @ApiProperty({
    description: 'Address of the assigned delegate',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
  })
  delegateAddress: string;

  @ApiProperty({ description: 'Transaction hash', example: 'ABC123...ABCD' })
  transactionHash: string;

  @ApiProperty({ description: 'Timestamp of the operation', example: '2026-03-30T12:30:00.000Z' })
  timestamp: Date;

  @ApiProperty({ description: 'Operation status', example: 'success' })
  status: string;

  @ApiProperty({
    description: 'Unix timestamp when the delegation expires, or null for no expiry',
    example: 1735689600,
    required: false,
    nullable: true,
  })
  expiresAt?: number;
}

/**
 * Response shape for a revoke-delegate operation.
 */
export class RevokeDelegateResponseDto {
  @ApiProperty({ description: 'Package ID whose delegate was revoked', example: 'pkg_123456789' })
  packageId: string;

  @ApiProperty({ description: 'Transaction hash', example: 'ABC123...ABCD' })
  transactionHash: string;

  @ApiProperty({ description: 'Timestamp of the operation', example: '2026-03-30T12:30:00.000Z' })
  timestamp: Date;

  @ApiProperty({ description: 'Operation status', example: 'success' })
  status: string;
}

/**
 * Response shape for get-delegate queries.
 */
export class GetDelegateResponseDto {
  @ApiProperty({ description: 'Package ID', example: 'pkg_123456789' })
  packageId: string;

  @ApiProperty({
    description: 'Current active delegate address, or null if none or expired',
    example: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
    nullable: true,
  })
  delegateAddress: string | null;

  @ApiProperty({
    description: 'Unix timestamp when the delegation expires, or null for no expiry / no delegate',
    example: 1735689600,
    nullable: true,
  })
  expiresAt: number | null;

  @ApiProperty({ description: 'Response timestamp', example: '2026-03-30T12:30:00.000Z' })
  timestamp: Date;
}

/**
 * A single entry in the delegate audit history.
 */
export class DelegateHistoryEntryDto {
  @ApiProperty({ description: 'Package ID this history entry belongs to', example: 'pkg_123456789' })
  packageId: string;

  @ApiProperty({
    description: 'Address that held the delegate role before this change, or null for the first assignment',
    nullable: true,
  })
  previousDelegate: string | null;

  @ApiProperty({ description: 'Address that became (or was cleared as) the delegate' })
  newDelegate: string;

  @ApiProperty({ description: 'Address that authorised the change' })
  changedBy: string;

  @ApiProperty({ description: 'Unix timestamp when the change occurred', example: 1711814400 })
  changedAt: number;

  @ApiProperty({ description: 'Reason code for the change', example: 'delegate_set' })
  reason: string;
}

/**
 * Response shape for delegate history queries.
 */
export class GetDelegateHistoryResponseDto {
  @ApiProperty({ description: 'Package ID', example: 'pkg_123456789' })
  packageId: string;

  @ApiProperty({ type: [DelegateHistoryEntryDto], description: 'Chronological list of delegate changes' })
  history: DelegateHistoryEntryDto[];

  @ApiProperty({ description: 'Response timestamp', example: '2026-03-30T12:30:00.000Z' })
  timestamp: Date;
}
