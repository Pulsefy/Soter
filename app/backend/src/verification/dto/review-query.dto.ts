import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum ReviewStatusFilter {
  pending_review = 'pending_review',
  approved = 'approved',
  rejected = 'rejected',
}

export class ReviewQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by review status',
    enum: ReviewStatusFilter,
    example: 'pending_review',
  })
  @IsOptional()
  @IsEnum(ReviewStatusFilter)
  status?: ReviewStatusFilter;

  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
