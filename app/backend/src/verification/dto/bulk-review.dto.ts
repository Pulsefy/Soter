import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, ArrayNotEmpty } from 'class-validator';

export enum BulkReviewAction {
  APPROVE = 'approve',
  REJECT = 'reject',
  REQUEUE = 'requeue',
}

export class BulkReviewDto {
  @ApiProperty({ enum: BulkReviewAction })
  @IsEnum(BulkReviewAction)
  action: BulkReviewAction;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  ids: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nextStepMessage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  internalNote?: string;
}
