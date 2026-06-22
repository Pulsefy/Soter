import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class CreateObservabilityDto {
  @ApiProperty({
    example: 'service.metrics',
    description: 'Name or type of observability event',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description: 'Arbitrary payload data associated with the event.',
    example: { durationMs: 150, endpoint: '/api/v1/verify' },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
