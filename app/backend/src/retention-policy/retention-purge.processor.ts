import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RetentionPolicyService } from './retention-policy.service';

export const RETENTION_PURGE_QUEUE = 'retention-purge';

export interface RetentionPurgeJobData {
  triggeredBy: string; // 'cron' | 'manual' | 'api'
  timestamp: number;
}

@Processor(RETENTION_PURGE_QUEUE)
export class RetentionPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionPurgeProcessor.name);

  constructor(private readonly retentionService: RetentionPolicyService) {
    super();
  }

  async process(job: Job<RetentionPurgeJobData>): Promise<void> {
    this.logger.log(
      `Processing retention purge job ${job.id} (triggered by: ${job.data.triggeredBy})`,
    );

    try {
      const results = await this.retentionService.executePurge();
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
}
