import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class RotateApiKeyDto {
  @ApiPropertyOptional({
    description:
      'Optional absolute expiry for the replacement key (ISO-8601). Mutually exclusive with expiresInDays. If omitted, inherits the previous key expiry when set.',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description:
      'Optional relative TTL in days for the replacement key. Mutually exclusive with expiresAt.',
    example: 90,
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  @ApiPropertyOptional({
    description:
      'Optional overlap window (hours) during which the predecessor key remains valid alongside the replacement. Defaults to 24 hours when omitted.',
    example: 24,
    minimum: 1,
    maximum: 720,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  gracePeriodHours?: number;
}
