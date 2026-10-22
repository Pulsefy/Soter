import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReverifyClaimDto {
  @ApiProperty({
    description:
      'Why verification is being re-run (recorded in the audit log).',
    minLength: 5,
    maxLength: 500,
    example: 'Evidence corrected after submission',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Required to re-verify a claim in a terminal state (disbursed, archived or cancelled). The override is logged.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}