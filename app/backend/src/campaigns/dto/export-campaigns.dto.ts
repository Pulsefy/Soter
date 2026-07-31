import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CampaignStatus } from '@prisma/client';

export class ExportCampaignsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsString()
  orgId?: string;

  @IsOptional()
  @IsString()
  ngoId?: string;
}
