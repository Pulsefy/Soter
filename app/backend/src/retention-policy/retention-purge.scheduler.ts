import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RETENTION_PURGE_QUEUE, RetentionPurgeJobData } from './retention-purge.processor';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RetentionPurgeScheduler {
  private readonly logger = new Logger(RetentionPurgeScheduler.name);

  constructor(
    @InjectQueue(RETENTION_PURGE_QUEUE)
    private readonly purgeQueue: Queue<RetentionPurgeJobData>,
    private readonly configService: ConfigService,
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
      this.logger.error('Failed to enqueue retention purge', err as any);
    }
  }
}
