import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export enum TaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class AiTaskWebhookDto {
  @ApiProperty({
    description: 'The ID of the task',
    example: 'task-123-abc',
  })
  @IsString()
  @IsNotEmpty()
  taskId!: string;

  @ApiProperty({
    description: 'Status of the task',
    enum: TaskStatus,
    example: 'completed',
  })
  @IsEnum(TaskStatus)
  status!: TaskStatus;

  @ApiPropertyOptional({
    description: 'Result of the task execution',
    example: { prediction: 'approved', confidence: 0.95 },
  })
  @IsOptional()
  result?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Error message if task failed',
    example: 'Image processing failed: invalid format',
  })
  @IsOptional()
  @IsString()
  error?: string;

  @ApiPropertyOptional({
    description: 'Type of the task',
    example: 'image_analysis',
  })
  @IsOptional()
  @IsString()
  taskType?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the task completed',
    example: '2024-03-24T10:30:00Z',
  })
  @IsOptional()
  @IsString()
  completedAt?: string;
}
