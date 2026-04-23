import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ReviewDecision {
  approved = 'approved',
  rejected = 'rejected',
}

export class SubmitReviewDto {
  @ApiProperty({
    description: 'Review decision',
    enum: ReviewDecision,
    example: 'approved',
  })
  @IsEnum(ReviewDecision)
  @IsNotEmpty()
  decision!: ReviewDecision;

  @ApiProperty({
    description: 'Reason for the decision',
    example: 'All documents verified successfully',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Internal note (not visible to claimant)',
    example: 'Contacted applicant for additional verification',
    maxLength: 1000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}
