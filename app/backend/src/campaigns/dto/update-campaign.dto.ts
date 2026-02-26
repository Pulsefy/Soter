import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// Local enum definition to avoid Prisma import issues
enum CampaignStatus {
  draft = 'draft',
  active = 'active',
  paused = 'paused',
  completed = 'completed',
  archived = 'archived',
}

export class UpdateCampaignDto {
  @ApiPropertyOptional({
    description: 'Updated campaign title/name.',
    example: 'Winter Relief 2026 - Extended',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated campaign budget.',
    example: 30000.0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budget?: number;

  @ApiPropertyOptional({
    description: 'Updated campaign metadata.',
    example: { region: 'Lagos', partner: 'NGO-B' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Updated campaign status.',
    enum: CampaignStatus,
    enumName: 'CampaignStatus',
    example: CampaignStatus.active,
  })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}
