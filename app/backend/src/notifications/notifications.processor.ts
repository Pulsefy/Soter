import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NotificationJobData,
  NotificationResult,
} from './interfaces/notification-job.interface';
import { DeadLetterService } from '../jobs/dead-letter.service';

@Processor('notifications', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @Optional()
    private readonly deadLetterService: DeadLetterService | null,
  ) {
    super();
  }

  async process(
    job: Job<NotificationJobData, NotificationResult, string>,
  ): Promise<NotificationResult> {
    this.logger.log(
      `Processing ${job.data.type} notification for ${job.data.recipient} ` +
        `(attempt ${job.attemptsMade + 1}/${job.opts?.attempts ?? '?'})`,
    );

    try {
      // Mock: In production, integrate with SendGrid, Twilio, etc.
      this.logger.debug(
        `[Mock] Sending ${job.data.type} to ${job.data.recipient}: ${job.data.message}`,
      );

      // Simulate some processing time
      await new Promise(resolve => setTimeout(resolve, 100));

      return {
        success: true,
        messageId: `mock-msg-${Date.now()}`,
      };
    } catch (error) {
      this.logger.error(
        `Notification job ${job.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<NotificationJobData, NotificationResult>): void {
    this.logger.log(
      `Notification job ${job.id} for ${job.data.recipient} completed successfully`,
    );
  }

  /**
   * Called after the final failed attempt.
   * Moves the job to the Dead Letter Queue when all retries are exhausted.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<NotificationJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.error(`Notification job failed (no job reference): ${error.message}`);
      return;
    }

    const maxAttempts = job.opts?.attempts ?? 3;
    const isExhausted = job.attemptsMade >= maxAttempts;

    this.logger.error(
      `Notification job ${job.id} for ${job.data.recipient} failed on attempt ` +
        `${job.attemptsMade}/${maxAttempts}: ${error.message}`,
    );

    if (isExhausted && this.deadLetterService) {
      await this.deadLetterService.moveToDeadLetter('notifications', job, error);
    }
  }
}
