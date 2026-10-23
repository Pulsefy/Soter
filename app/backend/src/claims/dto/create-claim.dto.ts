import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Matches,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClaimDto {
  @ApiProperty({
    description: 'ID of the campaign this claim belongs to',
    example: 'campaign-uuid',
  })
  @IsNotEmpty()
  @IsString()
  campaignId: string;

  @ApiProperty({
    description: 'Amount requested in the claim',
    example: 100.5,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({
    description: 'Reference to the recipient',
    example: 'recipient-123',
  })
  @IsNotEmpty()
  @IsString()
  recipientRef: string;

  @ApiProperty({
    description:
      'Stellar token address (asset issuer or contract ID) for the distribution',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^G[A-Z0-9]{55}$|^C[A-Z0-9]{55}$/, {
    message:
      'tokenAddress must be a valid Stellar address (G... or C... format)',
  })
  tokenAddress: string;

  @ApiPropertyOptional({
    description:
      'Reference or link to evidence supporting the claim (e.g., photo, document hash).',
    example: 'evidence-456',
  })
  @IsOptional()
  @IsString()
  evidenceRef?: string;

  @ApiPropertyOptional({
    description:
      'When the claim should automatically expire if it remains unprocessed.',
    example: '2026-05-31T23:59:59.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @ApiPropertyOptional({
    description:
      'Recipient-import job that produced this claim. Set by the import pipeline; used for idempotent re-runs together with importRowNumber.',
    example: 'import-job-uuid-123',
  })
  @IsOptional()
  @IsString()
  importJobId?: string;

  @ApiPropertyOptional({
    description:
      'Zero-based row number within the import job. Used with importJobId to make imports idempotent.',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  importRowNumber?: number;
}
