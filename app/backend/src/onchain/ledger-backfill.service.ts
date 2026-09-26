import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  BackfillCheckpointService,
  buildJobKey,
  CheckpointData,
} from './backfill-checkpoint.service';
import {
  SorobanEventCorrelationService,
  CorrelationJobData,
} from './soroban-event-correlation.service';
import { MetricsService } from '../observability/metrics/metrics.service';

export interface BackfillJobData {
  startLedger: number;
  endLedger: number;
  campaignId?: string;
  batchSize: number;
  /** jobKey ties this BullMQ job to its checkpoint row */
  jobKey: string;
}

export interface BackfillResult {
  jobId: string;
  jobKey: string;
  startLedger: number;
  endLedger: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  processedCount: number;
  totalLedgers: number;
  lastProcessedLedger?: number;
}

export interface BackfillBatchResult {
  processed: number;
  skipped: number;
  errors: string[];
  lastProcessedLedger: number;
}

/**
 * LedgerBackfillService orchestrates range-based Soroban event backfills.
 *
 * Key features:
 * - Idempotent: creates or resumes a BackfillCheckpoint row per unique range/campaign.
 * - Safe resume: processing always starts at checkpoint.lastProcessedLedger + 1.
 * - Per-batch progress logging and Prometheus metrics emission.
 * - Delegates actual event fetching to SorobanEventCorrelationService.
 */
@Injectable()
export class LedgerBackfillService {
  private readonly logger = new Logger(LedgerBackfillService.name);

  constructor(
    private readonly checkpointService: BackfillCheckpointService,
    private readonly eventCorrelationService: SorobanEventCorrelationService,
    private readonly metricsService: MetricsService,
    @InjectQueue('ledger-backfill')
    private readonly backfillQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API — called from LedgerAdminController
  // ---------------------------------------------------------------------------

  /**
   * Enqueue (or re-enqueue) a backfill job for the given ledger range.
   * Creates/resumes a checkpoint so the worker can safely resume after failure.
   */
  async triggerBackfill(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
    batchSize = 100,
  ): Promise<BackfillResult> {
    this.logger.log(
      `Triggering backfill for ledgers ${startLedger}-${endLedger}` +
        (campaignId ? ` (campaignId=${campaignId})` : ''),
    );

    const totalCount = endLedger - startLedger + 1;

    const job = await this.onchainQueue.add(
      'ledger-backfill',
      {
        startLedger,
        endLedger,
        campaignId,
        batchSize,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          count: 10,
          age: 3600,
        },
        removeOnFail: {
          count: 5,
          age: 7200,
        },
      },
    );

    const jobData: BackfillJobData = {
      startLedger,
      endLedger,
      campaignId,
      batchSize,
      jobKey: checkpoint.jobKey,
    };

    const job = await this.backfillQueue.add('process-backfill', jobData, {
      jobId: checkpoint.jobKey, // dedup by jobKey so re-trigger is idempotent
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 20, age: 7200 },
      removeOnFail: { count: 10, age: 86400 },
    });

    const totalLedgers = endLedger - startLedger + 1;

    this.metricsService.incrementCounter('backfill_jobs_triggered_total', {
      campaign_id: campaignId ?? 'none',
    });

    return {
      jobId: job.id ?? 'unknown',
      jobKey: checkpoint.jobKey,
      startLedger,
      endLedger,
      status: 'queued',
      processedCount: checkpoint.processedCount,
      totalLedgers,
      lastProcessedLedger: checkpoint.lastProcessedLedger,
    };
  }

  /**
   * Retrieve the current backfill status from checkpoint + queue state.
   */
  async getBackfillStatus(
    jobKeyOrJobId: string,
  ): Promise<BackfillResult | null> {
    // Try checkpoint first
    let checkpoint = await this.checkpointService.getCheckpoint(jobKeyOrJobId);

    if (!checkpoint) {
      // Fall back to BullMQ job ID lookup
      const job = await this.backfillQueue.getJob(jobKeyOrJobId);
      if (!job) return null;

      const data = job.data as BackfillJobData;
      checkpoint = await this.checkpointService.getCheckpoint(data.jobKey);
      if (!checkpoint) return null;
    }

    return {
      jobId: checkpoint.jobKey,
      jobKey: checkpoint.jobKey,
      startLedger: checkpoint.startLedger,
      endLedger: checkpoint.endLedger,
      status: this.mapCheckpointStatus(checkpoint.status),
      processedCount: checkpoint.processedCount,
      totalLedgers: checkpoint.endLedger - checkpoint.startLedger + 1,
      lastProcessedLedger: checkpoint.lastProcessedLedger,
    };
  }

  /**
   * List recent backfill checkpoints (for admin dashboard).
   */
  async listCheckpoints(params?: {
    status?: BackfillStatus | string;
    campaignId?: string;
    limit?: number;
  }) {
    return this.checkpointService.listCheckpoints({
      ...params,
      status: params?.status as BackfillStatus | undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Worker-facing API — called from LedgerBackfillProcessor
  // ---------------------------------------------------------------------------

  /**
   * Execute the backfill for an enqueued job.  Resumes from checkpoint.
   * Reports per-batch progress and emits structured metrics.
   */
  async executeBackfill(
    data: BackfillJobData,
    onProgress?: (percent: number, message: string) => Promise<void>,
  ): Promise<BackfillBatchResult> {
    const { startLedger, endLedger, campaignId, batchSize, jobKey } = data;
    const startTime = Date.now();

    const checkpoint = await this.checkpointService.markRunning(jobKey);
    const resumeFrom = checkpoint.lastProcessedLedger + 1;
    const totalLedgers = endLedger - startLedger + 1;

    this.logger.log(
      `[${jobKey}] Starting backfill execution: ledgers ${resumeFrom}-${endLedger}` +
        ` (${endLedger - resumeFrom + 1} remaining of ${totalLedgers} total)`,
    );

    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];
    let lastProcessedLedger = checkpoint.lastProcessedLedger;

    for (
      let batchStart = resumeFrom;
      batchStart <= endLedger;
      batchStart += batchSize
    ) {
      const batchEnd = Math.min(batchStart + batchSize - 1, endLedger);
      const batchLabel = `ledgers ${batchStart}-${batchEnd}`;

      try {
        this.logger.log(`[${jobKey}] Processing batch: ${batchLabel}`);

        const correlationData: CorrelationJobData = {
          startLedger: batchStart,
          endLedger: batchEnd,
          correlationSource: 'manual',
          ...(campaignId ? {} : {}), // contractId falls back to env default
        };

        const result =
          await this.eventCorrelationService.correlateEvents(correlationData);

        processed += result.correlated;
        skipped += result.skipped;
        if (result.errors > 0) {
          const errMsg = `Batch ${batchLabel}: ${result.errors} correlation errors`;
          errors.push(errMsg);
          this.logger.warn(`[${jobKey}] ${errMsg}`);
        }

        lastProcessedLedger = batchEnd;

        // Persist checkpoint after each successful batch
        await this.checkpointService.advanceCheckpoint(
          jobKey,
          batchEnd,
          result.correlated,
          result.errors,
        );

        // Emit per-batch metrics
        this.metricsService.incrementCounter(
          'backfill_ledgers_processed_total',
          {
            campaign_id: campaignId ?? 'none',
          },
        );
        if (result.errors > 0) {
          this.metricsService.incrementCounter(
            'backfill_ledgers_failed_total',
            {
              campaign_id: campaignId ?? 'none',
            },
          );
        }

        // Report progress percentage
        const progressPercent = Math.floor(
          ((batchEnd - startLedger + 1) / totalLedgers) * 100,
        );
        this.metricsService.setGauge('backfill_progress', progressPercent, {
          job_key: jobKey,
        });

        if (onProgress) {
          await onProgress(
            progressPercent,
            `Processed ${batchLabel}: ${result.correlated} events correlated`,
          );
        }

        this.logger.log(
          `[${jobKey}] Batch done: ${batchLabel} — correlated=${result.correlated} ` +
            `skipped=${result.skipped} errors=${result.errors} progress=${progressPercent}%`,
        );
      } catch (error) {
        const errorMsg = `Batch ${batchLabel} failed: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.error(`[${jobKey}] ${errorMsg}`, {
          error: error instanceof Error ? error.stack : String(error),
        });
        errors.push(errorMsg);

        // Save error state but keep lastProcessedLedger unchanged (re-try this batch)
        await this.checkpointService.advanceCheckpoint(
          jobKey,
          lastProcessedLedger,
          0,
          1,
        );

        this.metricsService.incrementCounter('backfill_ledgers_failed_total', {
          campaign_id: campaignId ?? 'none',
        });

        // Rethrow so BullMQ can retry the whole job (which will resume from checkpoint)
        throw error;
      }
    }

    const durationSeconds = (Date.now() - startTime) / 1000;

    // Mark complete
    await this.checkpointService.markCompleted(jobKey);

    this.metricsService.recordHistogram(
      'backfill_duration_seconds',
      durationSeconds,
      { campaign_id: campaignId ?? 'none' },
    );
    this.metricsService.setGauge('backfill_progress', 100, { job_key: jobKey });

    this.logger.log(
      `[${jobKey}] Backfill completed: ${processed} events correlated, ` +
        `${skipped} skipped, ${errors.length} errors in ${durationSeconds.toFixed(2)}s`,
    );

    return { processed, skipped, errors, lastProcessedLedger };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private mapCheckpointStatus(
    status: CheckpointData['status'],
  ): BackfillResult['status'] {
    switch (status) {
      case 'running':
        return 'processing';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'queued';
    }
  }

  // Kept for backward-compat with existing onchain processor job type
  async processBackfillBatch(data: BackfillJobData): Promise<{
    processed: number;
    skipped: number;
    errors: string[];
  }> {
    const result = await this.executeBackfill(data);
    return {
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors,
    };
  }

  /** buildJobKey helper exposed so controller can look up status by params */
  static buildJobKey = buildJobKey;
}
