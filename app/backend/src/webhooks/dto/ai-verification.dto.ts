import {
  IsString,
  IsUUID,
  IsOptional,
  IsObject,
  ValidateNested,
  IsNumber,
} from 'class-validator'; // Added IsNumber
import { Type } from 'class-transformer';

/**
 * Contract-aware metadata for AI verification results
 */
export class ContractMetadataDto {
  @IsUUID()
  campaignId: string;

  @IsUUID()
  claimId: string;

  @IsString()
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

  @IsOptional()
  @IsString()
  chainId?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  timestamp?: Date;
}

/**
 * AI verification result DTO with metadata
 */
export class AIVerificationResultDto {
  @IsNumber()
  score: number;

  @IsNumber()
  confidence: number;

  @IsOptional()
  @IsObject()
  details?: {
    factors?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    recommendations?: string[];
  };

  @IsOptional()
  @ValidateNested()
  @Type(() => ContractMetadataDto)
  metadata?: ContractMetadataDto;

  @IsOptional()
  @IsString({ each: true })
  warnings?: string[];
}

/**
 * Webhook payload with contract-aware metadata validation
 */
export class AIVerificationWebhookDto {
  @IsUUID()
  @IsString()
  claimId: string;

  @IsUUID()
  @IsString()
  campaignId: string;

  @IsString()
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

  @ValidateNested()
  @Type(() => AIVerificationResultDto)
  result: AIVerificationResultDto;

  @IsOptional()
  @IsString({ each: true })
  warnings?: string[];
}

// Keep existing exports for backward compatibility
export * from '../../ai-verification.dto';
