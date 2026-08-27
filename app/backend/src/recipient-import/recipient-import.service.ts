import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ImportError,
  ImportJobResumeState,
  ImportJobStatusResponse,
} from './interfaces/import-job.interface';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

const BATCH_SIZE = 100;

@Injectable()
export class RecipientImportService implements OnModuleInit {
  private readonly logger = new Logger(RecipientImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @InjectQueue('recipient-import')
    private readonly recipientImportQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.resumeInterruptedJobs();
  }

  async createJob(
    campaignId: string,
    fileName: string,
    filePath: string,
    totalRows: number,
  ): Promise<{ jobId: string; totalRows: number; status: string }> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new BadRequestException('Campaign not found');
    }

    if (totalRows <= 0) {
      throw new BadRequestException('CSV file contains no data rows');
    }

    const job = await this.prisma.importJob.create({
      data: {
        campaignId,
        fileName,
        filePath,
        totalRows,
        status: 'pending',
      },
    });

    await this.recipientImportQueue.add(
      'process-import',
      {
        jobId: job.id,
        campaignId,
        fileName,
        filePath,
        totalRows,
      },
      {
        jobId: job.id,
      },
    );

    await this.auditService.record({
      actorId: 'system',
      entity: 'ImportJob',
      entityId: job.id,
      action: 'created',
      metadata: { campaignId, fileName, totalRows },
    });

    this.logger.log(
      `Import job ${job.id} created for campaign ${campaignId} (${totalRows} rows)`,
    );

    return { jobId: job.id, totalRows, status: 'pending' };
  }

  async getJobStatus(jobId: string): Promise<ImportJobStatusResponse> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    const progress =
      job.totalRows > 0
        ? Math.round((job.processedRows / job.totalRows) * 100)
        : 0;

    const parsedErrors = this.parseErrors(job.errors);

    return {
      id: job.id,
      status: job.status,
      campaignId: job.campaignId,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      errorRows: job.errorRows,
      checkpointRow: job.checkpointRow,
      errors: parsedErrors.length > 0 ? parsedErrors : null,
      reportUrl: job.reportUrl,
      fileName: job.fileName,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      cancelledAt: job.cancelledAt,
      progress,
    };
  }

  async updateJobProgress(
    jobId: string,
    processedRows: number,
    errorRows: number,
    errors: ImportError[],
  ): Promise<void> {
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        processedRows,
        errorRows,
        checkpointRow: processedRows,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
      },
    });
  }

  async completeJob(
    jobId: string,
    processedRows: number,
    errorRows: number,
    errors: ImportError[],
    reportUrl: string | null,
    statusOverride?: 'completed' | 'failed',
  ): Promise<void> {
    const status = statusOverride ?? (errorRows > 0 ? 'failed' : 'completed');

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status,
        processedRows,
        errorRows,
        checkpointRow: processedRows,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        reportUrl,
        completedAt: new Date(),
      },
    });

    await this.auditService.record({
      actorId: 'system',
      entity: 'ImportJob',
      entityId: jobId,
      action: 'completed',
      metadata: { status, processedRows, errorRows, reportUrl },
    });

    this.logger.log(
      `Import job ${jobId} completed: status=${status}, processed=${processedRows}, errors=${errorRows}`,
    );
  }

  async setJobProcessing(jobId: string): Promise<boolean> {
    const result = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: { not: 'cancelled' } },
      data: { status: 'processing', startedAt: new Date() },
    });

    return result.count > 0;
  }

  async getResumeState(jobId: string): Promise<ImportJobResumeState> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    return {
      id: job.id,
      status: job.status,
      campaignId: job.campaignId,
      fileName: job.fileName,
      filePath: job.filePath,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      errorRows: job.errorRows,
      checkpointRow: job.checkpointRow,
      errors: this.parseErrors(job.errors),
    };
  }

  async hasImportedRow(jobId: string, rowNumber: number): Promise<boolean> {
    const existing = await this.prisma.claim.findFirst({
      where: { importJobId: jobId, importRowNumber: rowNumber },
      select: { id: true },
    });
    return !!existing;
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return job?.status === 'cancelled';
  }

  async cancelJob(jobId: string): Promise<ImportJobStatusResponse> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      const queuedJob = await this.recipientImportQueue.getJob(jobId);
      if (queuedJob) {
        try {
          await queuedJob.remove();
        } catch {
          // Active jobs cannot be removed; the processor checks cancellation before each row.
        }
      }

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          completedAt: new Date(),
        },
      });

      await this.auditService.record({
        actorId: 'system',
        entity: 'ImportJob',
        entityId: jobId,
        action: 'cancelled',
        metadata: {
          processedRows: job.processedRows,
          errorRows: job.errorRows,
          checkpointRow: job.checkpointRow,
        },
      });
    }

    return this.getJobStatus(jobId);
  }

  async resumeInterruptedJobs(): Promise<void> {
    const interruptedJobs = await this.prisma.importJob.findMany({
      where: { status: 'processing' },
    });

    for (const job of interruptedJobs) {
      if (!job.filePath) {
        continue;
      }

      await this.recipientImportQueue.add(
        'process-import',
        {
          jobId: job.id,
          campaignId: job.campaignId,
          fileName: job.fileName,
          filePath: job.filePath,
          totalRows: job.totalRows,
        },
        { jobId: job.id },
      );
    }
  }

  parseCsv(content: string): { headers: string[]; rows: string[][] } {
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    const headers = this.parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(line => this.parseCsvLine(line));

    return { headers, rows };
  }

  validateRow(
    row: string[],
    headers: string[],
    rowIndex: number,
  ): {
    valid: boolean;
    recipientRef?: string;
    amount?: number;
    evidenceRef?: string;
    errors: ImportError[];
  } {
    const errors: ImportError[] = [];
    const headerMap = new Map(
      headers.map((h, i) => [h.toLowerCase().trim(), i]),
    );

    const recipientRefIdx = headerMap.get('recipientref');
    const amountIdx = headerMap.get('amount');
    const evidenceRefIdx = headerMap.get('evidenceref');

    if (recipientRefIdx === undefined || !row[recipientRefIdx]?.trim()) {
      errors.push({
        row: rowIndex,
        field: 'recipientRef',
        message: 'Missing or empty recipientRef',
      });
    }

    if (amountIdx === undefined) {
      errors.push({
        row: rowIndex,
        field: 'amount',
        message: 'Missing amount column',
      });
    } else {
      const amountStr = row[amountIdx]?.trim();
      const amount = parseFloat(amountStr ?? '');
      if (isNaN(amount) || amount <= 0) {
        errors.push({
          row: rowIndex,
          field: 'amount',
          message: 'Invalid or non-positive amount',
          value: amountStr,
        });
      } else {
        return {
          valid: errors.length === 0,
          recipientRef: row[recipientRefIdx!]?.trim(),
          amount,
          evidenceRef:
            evidenceRefIdx !== undefined
              ? row[evidenceRefIdx]?.trim()
              : undefined,
          errors,
        };
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
      };
    }

    return {
      valid: true,
      recipientRef: row[recipientRefIdx!]?.trim(),
      amount:
        amountIdx !== undefined ? parseFloat(row[amountIdx].trim()) : undefined,
      evidenceRef:
        evidenceRefIdx !== undefined ? row[evidenceRefIdx]?.trim() : undefined,
      errors: [],
    };
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    result.push(current);
    return result;
  }

  private parseErrors(rawErrors: string | null): ImportError[] {
    if (!rawErrors) {
      return [];
    }

    try {
      return JSON.parse(rawErrors) as ImportError[];
    } catch {
      return [];
    }
  }

  getBatchSize(): number {
    return BATCH_SIZE;
  }

  async generateReportCsv(jobId: string): Promise<string> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }

    const errors = this.parseErrors(job.errors);

    if (errors.length === 0) {
      return 'row,field,message,value\nNo errors found for this import.';
    }

    const header = 'row,field,message,value\n';

    const rows = errors
      .map(err => {
        const rowNum = err.row ?? '';
        const field = (err.field ?? '').replace(/"/g, '""');
        const message = (err.message ?? '').replace(/"/g, '""');
        const value = (err.value ?? '').replace(/"/g, '""');
        return `${rowNum},"${field}","${message}","${value}"`;
      })
      .join('\n');

    return header + rows;
  }
}
