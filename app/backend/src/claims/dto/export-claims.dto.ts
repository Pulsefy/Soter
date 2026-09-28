import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ClaimStatus } from '@prisma/client';

export class ExportClaimsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsEnum(ClaimStatus)
  status?: ClaimStatus;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  orgId?: string;

  @IsOptional()
  @IsString()
  tokenAddress?: string;
}
