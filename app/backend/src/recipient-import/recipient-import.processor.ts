import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { readFileSync } from 'fs';
import { RecipientImportService } from './recipient-import.service';
import { ClaimsService } from '../claims/claims.service';
import { ImportJobData, ImportError } from './interfaces/import-job.interface';

const BATCH_SIZE = 100;

@Processor('recipient-import', {
  concurrency: parseInt(process.env.IMPORT_QUEUE_CONCURRENCY || '2'),
})
export class RecipientImportProcessor extends WorkerHost {
  private readonly logger = new Logger(RecipientImportProcessor.name);

  constructor(
    private readonly recipientImportService: RecipientImportService,
    private readonly claimsService: ClaimsService,
  ) {
    super();
  }

  async process(job: Job<ImportJobData, void, string>): Promise<void> {
    const jobId = job.id!;
    this.logger.log(
      `Processing import job ${jobId} for campaign ${job.data.campaignId}` +
        ` (${job.data.totalRows} rows from ${job.data.fileName})`,
    );

    const started = await this.recipientImportService.setJobProcessing(jobId);
    if (!started) {
      this.logger.log(`Import job ${jobId} was cancelled before processing`);
      return;
    }

    const resumeState = await this.recipientImportService.getResumeState(jobId);
    if (resumeState.status === 'cancelled') {
      this.logger.log(`Import job ${jobId} was cancelled before processing`);
      return;
    }

    const allErrors: ImportError[] = [...resumeState.errors];
    let processedRows = resumeState.processedRows;
    let errorRows = resumeState.errorRows;
    const filePath = resumeState.filePath ?? job.data.filePath;

    try {
      const fileContent = readFileSync(filePath, 'utf-8');
      const { headers, rows } =
        this.recipientImportService.parseCsv(fileContent);

      for (
        let i = resumeState.checkpointRow;
        i < rows.length;
        i += BATCH_SIZE
      ) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        for (let j = 0; j < batch.length; j++) {
          if (
            await this.recipientImportService.isCancellationRequested(jobId)
          ) {
            this.logger.log(
              `Import job ${jobId} cancelled at row checkpoint ${processedRows}`,
            );
            return;
          }

          const rowIndex = i + j + 2;
          const rowOffset = i + j + 1;
          const alreadyImported =
            await this.recipientImportService.hasImportedRow(jobId, rowIndex);

          if (alreadyImported) {
            processedRows = Math.max(processedRows, rowOffset);
            await this.checkpoint(job, processedRows, errorRows, allErrors);
            continue;
          }

          const validation = this.recipientImportService.validateRow(
            batch[j],
            headers,
            rowIndex,
          );

          if (!validation.valid) {
            allErrors.push(...validation.errors);
            errorRows++;
            processedRows++;
            await this.checkpoint(job, processedRows, errorRows, allErrors);
            continue;
          }

          try {
            await this.claimsService.create({
              campaignId: job.data.campaignId,
              amount: validation.amount!,
              recipientRef: validation.recipientRef!,
              evidenceRef: validation.evidenceRef,
              importJobId: jobId,
              importRowNumber: rowIndex,
              tokenAddress:
                'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
            });
            processedRows++;
          } catch (error) {
            if (this.isDuplicateImportedRow(error)) {
              processedRows++;
              await this.checkpoint(job, processedRows, errorRows, allErrors);
              continue;
            }

            allErrors.push({
              row: rowIndex,
              field: 'claim',
              message:
                error instanceof Error
                  ? error.message
                  : 'Failed to create claim',
            });
            errorRows++;
            processedRows++;
          }

          await this.checkpoint(job, processedRows, errorRows, allErrors);
        }
      }

      const reportUrl =
        allErrors.length > 0 ? `/recipient-import/${jobId}/report` : null;

      await this.recipientImportService.completeJob(
        jobId,
        processedRows,
        errorRows,
        allErrors,
        reportUrl,
      );

      this.logger.log(
        `Import job ${jobId} finished: processed=${processedRows}, errors=${errorRows}`,
      );
    } catch (error) {
      this.logger.error(
        `Import job ${jobId} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.recipientImportService.completeJob(
        jobId,
        processedRows,
        errorRows,
        allErrors,
        null,
        'failed',
      );

      throw error;
    }
  }

  private async checkpoint(
    job: Job<ImportJobData, void, string>,
    processedRows: number,
    errorRows: number,
    errors: ImportError[],
  ): Promise<void> {
    const jobId = job.id!;
    await this.recipientImportService.updateJobProgress(
      jobId,
      processedRows,
      errorRows,
      errors,
    );

    await job.updateProgress({
      processedRows,
      errorRows,
      totalRows: job.data.totalRows,
    });
  }

  private isDuplicateImportedRow(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const maybePrismaError = error as {
      code?: string;
      meta?: { target?: string | string[] };
    };
    const target = maybePrismaError.meta?.target;

    return (
      maybePrismaError.code === 'P2002' &&
      ((Array.isArray(target) &&
        target.includes('importJobId') &&
        target.includes('importRowNumber')) ||
        target === 'Claim_importJobId_importRowNumber_key')
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ImportJobData>) {
    this.logger.log(`Import job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ImportJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(`Import job ${job.id} failed: ${error.message}`);
    } else {
      this.logger.error(`Import job failed: ${error.message}`);
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<ImportJobData>) {
    this.logger.debug(`Import job ${job.id} started processing`);
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Import job ${jobId} stalled`);
  }
}
