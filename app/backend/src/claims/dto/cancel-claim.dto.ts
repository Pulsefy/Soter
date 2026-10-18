import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { CancelReasonCode } from '@prisma/client';

export class CancelClaimDto {
  @ApiProperty({
    description: 'ID of the operator performing the cancellation.',
    example: 'operator-uuid',
  })
  @IsString()
  @IsNotEmpty()
  operatorId!: string;

  @ApiProperty({
    description:
      'Machine-readable cancellation reason. Required so cancellations can be ' +
      'reported on without parsing free text.',
    enum: CancelReasonCode,
    example: CancelReasonCode.recipient_ineligible,
  })
  @IsEnum(CancelReasonCode, {
    message: `code must be one of: ${Object.values(CancelReasonCode).join(', ')}`,
  })
  code!: CancelReasonCode;

  @ApiPropertyOptional({
    description:
      'Free-text detail explaining the cancellation. Stored alongside the ' +
      'structured code; never parsed for reporting.',
    example: 'Recipient relocated; package no longer applicable.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
