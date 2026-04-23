import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus, ClaimStatus } from '@prisma/client';

export class ExportFiltersDto {
  @ApiPropertyOptional({ description: 'Filter by start date (ISO string)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter by end date (ISO string)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: { ...CampaignStatus, ...ClaimStatus },
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by organization ID' })
  @IsOptional()
  @IsString()
  ngoId?: string;

  @ApiPropertyOptional({ description: 'Filter by token address' })
  @IsOptional()
  @IsString()
  tokenAddress?: string;
}
