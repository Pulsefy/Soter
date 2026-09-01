import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RetentionPolicyService } from './retention-policy.service';
import { IdempotencyKeyRetentionService } from './idempotency-key-retention.service';
import { MetricsService } from '../observability/metrics/metrics.service';

export const RETENTION_PURGE_QUEUE = 'retention-purge';
export const IDEMPOTENCY_KEY_EXPIRY_SCOPE = 'idempotency-key-expiry';

/** Which retention work a purge job should perform. */
export type RetentionPurgeScope = 'policies' | 'idempotency-key-expiry';

export interface RetentionPurgeJobData {
  triggeredBy: string; // 'cron' | 'manual' | 'api'
  timestamp: number;
  dryRun?: boolean;
  batchSize?: number;
  scope?: RetentionPurgeScope;
}

@Processor(RETENTION_PURGE_QUEUE)
export class RetentionPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionPurgeProcessor.name);

  constructor(
    private readonly retentionService: RetentionPolicyService,
    private readonly idempotencyKeyRetentionService: IdempotencyKeyRetentionService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<RetentionPurgeJobData>): Promise<void> {
    this.logger.log(
      `Processing retention purge job ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );

    if (job.data.scope === IDEMPOTENCY_KEY_EXPIRY_SCOPE) {
      await this.processIdempotencyKeyExpiry(job);
      return;
    }

    try {
      const results = await this.retentionService.executePurge({
        dryRun: job.data.dryRun ?? false,
        batchSize: job.data.batchSize ?? undefined,
      });
      const totalAffected = results.reduce((sum, r) => sum + r.affected, 0);

      this.logger.log(
        `Retention purge job ${job.id} completed. ` +
          `Total records affected: ${totalAffected}`,
      );
    } catch (error) {
      this.logger.error(
        `Retention purge job ${job.id} failed: ${(error as Error).message}`,
      );
      throw error; // re-throw so BullMQ marks the job as failed
    }
  }

  /**
   * Purge expired idempotency keys in bounded batches. Failures are surfaced
   * through metrics, structured logs, and a re-thrown error so BullMQ marks
   * the job as failed and retries it.
   */
  private async processIdempotencyKeyExpiry(
    job: Job<RetentionPurgeJobData>,
  ): Promise<void> {
    const startedAt = Date.now();

    try {
      const summary =
        await this.idempotencyKeyRetentionService.purgeExpiredKeys();

      this.metrics.recordIdempotencyPurgeRun('success');

      this.logger.log(
        {
          operation: 'idempotency-key-purge',
          jobId: job.id,
          triggeredBy: job.data.triggeredBy,
          batchesRun: summary.batchesRun,
          recordsPurged: summary.recordsPurged,
          durationMs: Date.now() - startedAt,
        },
        RetentionPurgeProcessor.name,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.metrics.recordIdempotencyPurgeRun('failed');
      this.metrics.recordIdempotencyPurgeFailure(errorMessage);

      this.logger.error(
        {
          operation: 'idempotency-key-purge',
          jobId: job.id,
          error: errorMessage,
        },
        RetentionPurgeProcessor.name,
      );

      throw error; // re-throw so BullMQ marks the job as failed
    }
  }
}
