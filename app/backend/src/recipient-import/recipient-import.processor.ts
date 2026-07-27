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

    await this.recipientImportService.setJobProcessing(jobId);

    const allErrors: ImportError[] = [];
    let processedRows = 0;
    let errorRows = 0;

    try {
      const fileContent = readFileSync(job.data.filePath, 'utf-8');
      const { headers, rows } =
        this.recipientImportService.parseCsv(fileContent);

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        for (let j = 0; j < batch.length; j++) {
          const rowIndex = i + j + 2; // +2 for 1-indexed + header row
          const validation = this.recipientImportService.validateRow(
            batch[j],
            headers,
            rowIndex,
          );

          if (!validation.valid) {
            allErrors.push(...validation.errors);
            errorRows++;
            processedRows++;
            continue;
          }

          try {
            await this.claimsService.create({
              campaignId: job.data.campaignId,
              amount: validation.amount!,
              recipientRef: validation.recipientRef!,
              evidenceRef: validation.evidenceRef,
              tokenAddress:
                'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
            });
            processedRows++;
          } catch (error) {
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
        }

        await this.recipientImportService.updateJobProgress(
          jobId,
          processedRows,
          errorRows,
          allErrors,
        );

        await job.updateProgress({
          processedRows,
          errorRows,
          totalRows: job.data.totalRows,
        });
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
      );

      throw error;
    }
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
