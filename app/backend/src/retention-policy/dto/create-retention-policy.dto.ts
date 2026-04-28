import {
  IsString,
  IsInt,
  Min,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PurgeStrategyDto {
  soft_delete = 'soft_delete',
  hard_delete = 'hard_delete',
  anonymize = 'anonymize',
}

export class CreateRetentionPolicyDto {
  @ApiProperty({
    description:
      'Entity type this policy applies to (e.g. AuditLog, VerificationSession, Session, Claim)',
    example: 'AuditLog',
  })
  @IsString()
  entity: string;

  @ApiProperty({
    description: 'Number of days to retain records before purging',
    example: 90,
  })
  @IsInt()
  @Min(1)
  retentionDays: number;

  @ApiPropertyOptional({
    description: 'Purge strategy: soft_delete, hard_delete, or anonymize',
    enum: PurgeStrategyDto,
    default: 'soft_delete',
  })
  @IsOptional()
  @IsEnum(PurgeStrategyDto)
  strategy?: PurgeStrategyDto;

  @ApiPropertyOptional({
    description: 'Whether the policy is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Human-readable description of the policy',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
