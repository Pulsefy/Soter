import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CancellationReportQueryDto {
  @ApiPropertyOptional({
    description: 'Restrict the report to a single campaign.',
    example: 'clx0a1b2c3d4e5f6g7h8i9j0k1',
  })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({
    description:
      'Restrict to claims cancelled at or after this ISO-8601 timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  from?: string;

  @ApiPropertyOptional({
    description:
      'Restrict to claims cancelled at or before this ISO-8601 timestamp.',
    example: '2026-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  to?: string;
}
