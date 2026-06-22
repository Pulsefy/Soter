import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsObject,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SessionType } from '@prisma/client';

export class SessionStepDefinitionDto {
  @ApiProperty({ description: 'Name of the step' })
  @IsString()
  stepName: string;

  @ApiProperty({ description: 'Order of the step in the flow' })
  stepOrder: number;

  @ApiPropertyOptional({
    description: 'Maximum attempts allowed for this step',
  })
  @IsOptional()
  maxAttempts?: number;

  @ApiPropertyOptional({ description: 'Initial input data for the step' })
  @IsOptional()
  @IsObject()
  input?: Record<string, any>;
}

export class CreateSessionDto {
  @ApiProperty({
    enum: SessionType,
    description: 'Type of session to create',
  })
  @IsEnum(SessionType)
  type: SessionType;

  @ApiPropertyOptional({
    description: 'Context identifier (e.g., claim ID, user ID)',
  })
  @IsOptional()
  @IsString()
  contextId?: string;

  @ApiPropertyOptional({ description: 'Additional metadata for the session' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Session expiration time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    type: [SessionStepDefinitionDto],
    description: 'Steps to create for multi-step sessions',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionStepDefinitionDto)
  steps?: SessionStepDefinitionDto[];
}
