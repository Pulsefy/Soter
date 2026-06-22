import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CancelClaimDto {
  @ApiProperty({
    description: 'ID of the operator performing the cancellation.',
    example: 'operator-uuid',
  })
  @IsString()
  @IsNotEmpty()
  operatorId!: string;

  @ApiPropertyOptional({
    description: 'Human-readable reason for cancellation.',
    example: 'Recipient relocated; package no longer applicable.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
