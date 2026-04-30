import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';

@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(@InjectQueue('dead-letter') private readonly dlqQueue: Queue) {}

  /**
   * Move a failed job to the dead-letter queue if it has exhausted all attempts.
   */
  async moveToDlq(
    originalQueue: string,
    job: Job,
    error: Error,
  ): Promise<void> {
    const maxAttempts = job.opts.attempts || 1;
    if (job.attemptsMade >= maxAttempts) {
      try {
        this.logger.warn(
          `Moving job ${job.id} from queue ${originalQueue} to dead-letter queue after ${job.attemptsMade} attempts.`,
        );
        await this.dlqQueue.add(`dlq-${originalQueue}`, {
          originalId: job.id,
          originalQueue,
          data: job.data,
          failedReason: error.message,
          failedAt: new Date().toISOString(),
          attemptsMade: job.attemptsMade,
        });
      } catch (dlqError) {
        this.logger.error(
          `Failed to move job ${job.id} to dead-letter queue: ${dlqError instanceof Error ? dlqError.message : String(dlqError)}`,
        );
      }
    }
  }
}
