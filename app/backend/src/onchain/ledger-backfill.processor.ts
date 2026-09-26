import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  LedgerBackfillService,
  BackfillJobData,
  BackfillBatchResult,
} from './ledger-backfill.service';
import { BackfillCheckpointService } from './backfill-checkpoint.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { DlqService } from '../jobs/dlq.service';

/**
 * LedgerBackfillProcessor is the BullMQ worker that executes ledger backfill jobs.
 *
 * It delegates the actual processing to LedgerBackfillService.executeBackfill()
 * which handles checkpoint-aware resume logic.  Per-batch progress is reported
 * back to BullMQ so callers can poll for live progress.
 *
 * Concurrency is set to 1 to avoid overwhelming the Soroban RPC endpoint.
 */
@Processor('ledger-backfill', {
  concurrency: 1,
})
export class LedgerBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(LedgerBackfillProcessor.name);

  constructor(
    private readonly backfillService: LedgerBackfillService,
    private readonly checkpointService: BackfillCheckpointService,
    private readonly metricsService: MetricsService,
    private readonly dlqService: DlqService,
  ) {
    super();
  }

  async process(
    job: Job<BackfillJobData, BackfillBatchResult, string>,
  ): Promise<BackfillBatchResult> {
    const { jobKey, startLedger, endLedger, campaignId } = job.data;
    const startedAt = Date.now();

    this.logger.log(
      `[${jobKey}] Backfill job started (attempt ${job.attemptsMade + 1}): ` +
        `ledgers ${startLedger}-${endLedger}` +
        (campaignId ? ` campaignId=${campaignId}` : ''),
    );

    try {
      const result = await this.backfillService.executeBackfill(
        job.data,
        async (percent, message) => {
          // Report progress back into BullMQ for live polling
          await job.updateProgress({ percent, message });
        },
      );

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[${jobKey}] Job finished: processed=${result.processed} ` +
          `skipped=${result.skipped} errors=${result.errors.length} ` +
          `duration=${durationMs}ms`,
      );

      this.metricsService.incrementCounter('backfill_jobs_completed_total', {
        campaign_id: campaignId ?? 'none',
        status: 'success',
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[${jobKey}] Backfill job failed (attempt ${job.attemptsMade + 1}): ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      this.metricsService.incrementCounter('backfill_jobs_completed_total', {
        campaign_id: campaignId ?? 'none',
        status: 'failed',
      });

      // Update checkpoint to failed state if no more retries left
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        try {
          await this.checkpointService.markFailed(jobKey, errorMessage);
        } catch (e) {
          this.logger.warn(
            `[${jobKey}] Could not mark checkpoint as failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<BackfillJobData, BackfillBatchResult>) {
    this.logger.log(
      `[${job.data.jobKey}] Backfill job ${job.id} completed successfully`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<BackfillJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (job) {
      this.logger.error(
        `[${job.data.jobKey}] Backfill job ${job.id} failed: ${error.message}`,
      );
      // Move to DLQ only when exhausted
      if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
        await this.dlqService.moveToDlq('ledger-backfill', job, error);
      }
    } else {
      this.logger.error(`Backfill job failed: ${error.message}`);
    }
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job<BackfillJobData>, progress: unknown) {
    const p = progress as { percent: number; message: string };
    this.logger.debug(
      `[${job.data.jobKey}] Progress: ${p.percent}% — ${p.message}`,
    );
  }
}
