import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReissueClaimDto {
  @ApiProperty({
    description: 'ID of the operator performing the reissue.',
    example: 'operator-uuid',
  })
  @IsString()
  @IsNotEmpty()
  operatorId!: string;

  @ApiPropertyOptional({
    description:
      'Override amount for the replacement package. ' +
      'Defaults to the original amount when omitted.',
    example: 750,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({
    description: 'Override recipient reference for the replacement package.',
    example: 'recipient-ref-new',
  })
  @IsOptional()
  @IsString()
  recipientRef?: string;

  @ApiPropertyOptional({
    description: 'Human-readable reason for the reissue.',
    example: 'Corrected amount after field verification.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
