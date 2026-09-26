import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { CancelReasonCode } from '../cancel-reason.enum';

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
      'Enumerated reason code for the cancellation. Required so cancellations ' +
      'can be grouped and reported on without parsing free text.',
    enum: CancelReasonCode,
    example: CancelReasonCode.duplicate,
  })
  @IsEnum(CancelReasonCode)
  reasonCode!: CancelReasonCode;

  @ApiPropertyOptional({
    description:
      'Optional human-readable detail kept alongside the code ' +
      '(e.g. which duplicate claim this supersedes).',
    example: 'Duplicate of claim cm3xyz; recipient already paid.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
