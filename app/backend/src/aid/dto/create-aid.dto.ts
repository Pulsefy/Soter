import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class CreateAidDto {
  @ApiProperty({ example: 'campaign-uuid', description: 'Campaign id' })
  @IsString()
  @IsNotEmpty()
  campaignId!: string;

  @ApiPropertyOptional({ example: 'Immediate food relief' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;
}
