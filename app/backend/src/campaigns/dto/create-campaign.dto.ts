import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateCampaignDto {
  @ApiProperty({
    description: 'Campaign title/name.',
    example: 'Winter Relief 2026',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Total budget allocated to the campaign.',
    example: 25000.5,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budget!: number;

  @ApiPropertyOptional({
    description:
      'Arbitrary campaign metadata (e.g., region, location, target audience).',
    example: { region: 'Lagos', partner: 'NGO-A', notes: 'Phase 1' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Current status of the campaign.',
    enum: CampaignStatus,
    enumName: 'CampaignStatus',
    example: CampaignStatus.draft,
  })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}
