import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClaimDto {
  @ApiProperty({
    description: 'ID of the campaign this claim belongs to',
    example: 'campaign-uuid',
  })
  @IsNotEmpty()
  @IsString()
  campaignId: string;

  @ApiProperty({
    description: 'Amount requested in the claim',
    example: 100.5,
    minimum: 0,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({
    description: 'Reference to the recipient',
    example: 'recipient-123',
  })
  @IsNotEmpty()
  @IsString()
  recipientRef: string;

  @ApiPropertyOptional({
    description:
      'Reference or link to evidence supporting the claim (e.g., photo, document hash).',
    example: 'evidence-456',
  })
  @IsOptional()
  @IsString()
  evidenceRef?: string;
}
