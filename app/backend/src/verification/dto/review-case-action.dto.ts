import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class ReviewCaseActionDto {
  @ApiPropertyOptional({
    description: 'Optional reviewer notes for the decision.',
    example: 'Evidence is sufficient after cross-checking.',
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
