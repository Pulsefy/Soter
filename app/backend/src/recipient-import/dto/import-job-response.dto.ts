import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportJobStatus } from '@prisma/client';
import {
  ImportError,
  ImportJobStatusResponse,
} from '../interfaces/import-job.interface';

export class ImportJobResponseDto implements ImportJobStatusResponse {
  @ApiProperty({ description: 'Unique import job identifier' })
  id: string;

  @ApiProperty({ enum: ImportJobStatus, description: 'Current job status' })
  status: ImportJobStatus;

  @ApiProperty({ description: 'Campaign ID this import targets' })
  campaignId: string;

  @ApiProperty({ description: 'Total rows in the CSV file' })
  totalRows: number;

  @ApiProperty({ description: 'Number of rows processed so far' })
  processedRows: number;

  @ApiProperty({ description: 'Number of rows that failed processing' })
  errorRows: number;

  @ApiPropertyOptional({ description: 'Array of row-level errors' })
  errors: ImportError[] | null;

  @ApiPropertyOptional({ description: 'URL to download the full error report' })
  reportUrl: string | null;

  @ApiProperty({ description: 'Original uploaded file name' })
  fileName: string;

  @ApiProperty({ description: 'Job creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Completion timestamp' })
  completedAt: Date | null;

  @ApiProperty({
    description: 'Processing progress as a percentage (0–100)',
    minimum: 0,
    maximum: 100,
  })
  progress: number;
}

export class ImportJobCreatedDto {
  @ApiProperty({ description: 'Unique import job identifier' })
  jobId: string;

  @ApiProperty({ description: 'Total rows detected in the CSV' })
  totalRows: number;

  @ApiProperty({ description: 'Initial status' })
  status: ImportJobStatus;
}
