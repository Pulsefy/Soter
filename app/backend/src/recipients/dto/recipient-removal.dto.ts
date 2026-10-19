import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecipientRemovalReasonCode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RecipientRemovalDto {
  @ApiProperty({
    description: 'Structured reason for removing the recipient.',
    enum: RecipientRemovalReasonCode,
    example: RecipientRemovalReasonCode.ineligible,
  })
  @IsEnum(RecipientRemovalReasonCode)
  reasonCode!: RecipientRemovalReasonCode;

  @ApiPropertyOptional({
    description: 'Additional operator detail explaining the removal.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RecipientRemovalQueryDto {
  @ApiPropertyOptional({
    description: 'Filter removal records by recipient reference.',
  })
  @IsOptional()
  @IsString()
  recipientRef?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
