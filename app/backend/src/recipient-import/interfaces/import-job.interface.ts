import { ImportJobStatus } from '@prisma/client';

export interface ImportJobData {
  jobId: string;
  campaignId: string;
  fileName: string;
  filePath: string;
  totalRows: number;
}

export interface CsvRow {
  recipientRef: string;
  amount: number;
  evidenceRef?: string;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
  value?: string;
}

export interface ImportJobResult {
  jobId: string;
  processedRows: number;
  errorRows: number;
  errors: ImportError[];
  reportUrl: string | null;
}

export interface ImportJobStatusResponse {
  id: string;
  status: ImportJobStatus;
  campaignId: string;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  checkpointRow: number;
  errors: ImportError[] | null;
  reportUrl: string | null;
  fileName: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  progress: number;
}

export interface ImportJobResumeState {
  id: string;
  status: ImportJobStatus;
  campaignId: string;
  fileName: string;
  filePath: string | null;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  checkpointRow: number;
  errors: ImportError[];
}
