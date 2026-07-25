import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsUUID,
  IsNotEmpty,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Stable identifiers that link verification results to on-chain events
 */
export class ContractAwareMetadata {
  @IsUUID()
  @IsNotEmpty()
  campaignId: string;

  @IsUUID()
  @IsNotEmpty()
  claimId: string;

  @IsString()
  @IsNotEmpty()
  packageId: string;

  @IsString()
  @IsOptional()
  transactionHash?: string;

  @IsString()
  @IsOptional()
  contractAddress?: string;

  @IsString()
  @IsOptional()
  chainId?: string;

  @IsString()
  @IsOptional()
  network?: string;

  @IsString()
  @IsOptional()
  version?: string;

  @IsOptional()
  timestamp?: Date;
}

/**
 * Enhanced verification result with contract-aware metadata
 */
export class VerificationResultDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  score: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsOptional()
  details?: {
    factors?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    recommendations?: string[];
    rawResponse?: any;
  };

  @IsOptional()
  @Type(() => Date)
  processedAt?: Date;

  @IsOptional()
  metadata?: ContractAwareMetadata;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  validationErrors?: string[];
}

/**
 * DTO for webhook payload with metadata validation
 */
export class VerificationWebhookPayload {
  @IsUUID()
  @IsNotEmpty()
  claimId: string;

  @IsUUID()
  @IsNotEmpty()
  campaignId: string;

  @IsString()
  @IsNotEmpty()
  packageId: string;

  @IsOptional()
  @IsString()
  transactionHash?: string;

  @IsOptional()
  @IsString()
  contractAddress?: string;

  @IsOptional()
  @IsString()
  network?: string;

  result: VerificationResultDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  warnings?: string[];
}
