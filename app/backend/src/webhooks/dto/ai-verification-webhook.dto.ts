import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export enum TaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class AiVerificationWebhookDto {
  @ApiProperty({
    description: 'The AI service task ID',
    example: 'task-123-abc',
  })
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @ApiProperty({
    description: 'Unique delivery ID used for idempotent processing',
    example: 'del_12345abcde',
  })
  @IsString()
  @IsNotEmpty()
  deliveryId!: string;

  @ApiProperty({
    description: 'Timestamp of the event generation for state ordering',
    example: '2024-03-24T10:30:00Z',
  })
  @IsDateString()
  @IsNotEmpty()
  timestamp!: string;

  @ApiProperty({
    description: 'Current task status',
    enum: TaskStatus,
    example: TaskStatus.COMPLETED,
  })
  @IsEnum(TaskStatus)
  status!: TaskStatus;

  @ApiPropertyOptional({
    description: 'Task result when the AI service completed successfully',
    example: { prediction: 'approved', confidence: 0.95 },
  })
  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Error message when the AI service failed the task',
    example: 'Image processing failed: invalid format',
  })
  @ValidateIf(payload => payload.status === TaskStatus.FAILED)
  @IsString()
  @IsNotEmpty()
  error?: string;

  @ApiPropertyOptional({
    description: 'Type of AI task that produced this callback',
    example: 'humanitarian_verification',
  })
  @IsOptional()
  @IsString()
  taskType?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the task completed',
    example: '2024-03-24T10:35:00Z',
  })
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional({
    description: 'Callback contract version',
    example: '1.0',
  })
  @IsOptional()
  @IsString()
  schemaVersion?: string;
}
