import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsObject, IsOptional } from 'class-validator';

export class SubmitStepDto {
  @ApiProperty({ description: 'Unique key for idempotent submission' })
  @IsString()
  submissionKey: string;

  @ApiProperty({ description: 'Step input data' })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Optional step name to target specific step',
  })
  @IsOptional()
  @IsString()
  stepName?: string;
}
