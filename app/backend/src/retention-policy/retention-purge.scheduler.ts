import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  IDEMPOTENCY_KEY_EXPIRY_SCOPE,
  RETENTION_PURGE_QUEUE,
  RetentionPurgeJobData,
} from './retention-purge.processor';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics/metrics.service';

@Injectable()
export class RetentionPurgeScheduler {
  private readonly logger = new Logger(RetentionPurgeScheduler.name);
  private isScheduling = false;

  constructor(
    @InjectQueue(RETENTION_PURGE_QUEUE)
    private readonly purgeQueue: Queue<RetentionPurgeJobData>,
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  // Run daily at 00:00 UTC
  @Cron('0 0 * * *', { name: 'retention-daily', timeZone: 'UTC' })
  async scheduleDailyPurge() {
    try {
      const dryRun = this.configService.get('RETENTION_DRY_RUN') === 'true';
      const batchSize = this.configService.get('RETENTION_BATCH_SIZE');
      const jobData: RetentionPurgeJobData = {
        triggeredBy: 'cron',
        timestamp: Date.now(),
        dryRun,
        batchSize: batchSize ? Number(batchSize) : undefined,
      };

      await this.purgeQueue.add('scheduled-purge', jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      this.logger.log('Enqueued scheduled retention purge');
    } catch (err) {
      this.logger.error('Failed to enqueue retention purge', err);
    }
  }

  /**
   * Enqueue an idempotency key expiry purge once per hour.
   *
   * Expiration semantics stay independent of this schedule: a key becomes
   * invalid at its persisted `expiresAt` even if the purge has not run yet.
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
      await this.purgeQueue.add(
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
