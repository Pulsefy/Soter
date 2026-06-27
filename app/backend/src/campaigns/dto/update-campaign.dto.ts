import { ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus } from '@prisma/client';
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
    example: {
      region: 'Lagos',
      partner: 'NGO-B',
      anchor: {
        type: 'emergency_relief',
        ref: 'anchor-002',
        timestamp: '2026-06-26T11:30:00Z',
      },
    },
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
