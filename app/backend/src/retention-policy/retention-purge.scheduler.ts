import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  IDEMPOTENCY_KEY_EXPIRY_SCOPE,
  RETENTION_PURGE_QUEUE,
  RetentionPurgeJobData,
} from './retention-purge.processor';

/**
 * Schedules retention purge work that must run automatically.
 *
 * Expired idempotency keys are purged hourly by enqueueing a job on the
 * existing `retention-purge` queue, which is processed by
 * {@link RetentionPurgeProcessor}. Expiration semantics stay independent of
 * this schedule: a key becomes invalid at its persisted `expiresAt` even if
 * the purge has not run yet.
 */
@Injectable()
export class RetentionPurgeScheduler {
  private readonly logger = new Logger(RetentionPurgeScheduler.name);
  private isScheduling = false;

  constructor(
    @InjectQueue(RETENTION_PURGE_QUEUE)
    private readonly retentionPurgeQueue: Queue<RetentionPurgeJobData>,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Enqueue an idempotency key expiry purge once per hour.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'idempotency-key-expiry-purge',
    timeZone: 'UTC',
  })
  async scheduleIdempotencyKeyExpiryPurge(): Promise<void> {
    if (this.isScheduling) {
      this.logger.debug(
        'Idempotency key purge already scheduled, skipping this tick',
      );
      return;
    }

    this.isScheduling = true;

    try {
      await this.retentionPurgeQueue.add(
        IDEMPOTENCY_KEY_EXPIRY_SCOPE,
        {
          scope: IDEMPOTENCY_KEY_EXPIRY_SCOPE,
          triggeredBy: 'cron',
          timestamp: Date.now(),
        },
        {
          attempts: 2,
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );

      this.logger.log(
        {
          operation: 'idempotency-key-purge',
          job: 'schedule',
          triggeredBy: 'cron',
        },
        RetentionPurgeScheduler.name,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        {
          operation: 'idempotency-key-purge',
          job: 'schedule',
          error: errorMessage,
        },
        RetentionPurgeScheduler.name,
      );

      this.metrics.recordIdempotencyPurgeFailure(`scheduling: ${errorMessage}`);
    } finally {
      this.isScheduling = false;
    }
  }
}
