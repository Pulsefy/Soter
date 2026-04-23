import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class CreateAidDto {
  @ApiProperty({ example: 'campaign-uuid', description: 'Campaign id' })
  @IsString()
  @IsNotEmpty()
  campaignId!: string;

  @ApiPropertyOptional({
    description: 'Human-readable title for the aid packet.',
    example: 'Immediate food relief',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    description: 'Amount requested in the aid packet.',
    example: 1000,
    minimum: 0,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;
}
