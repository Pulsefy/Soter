import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NotificationJobData,
  NotificationResult,
} from './interfaces/notification-job.interface';

@Processor('notifications', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  async process(
    job: Job<NotificationJobData, NotificationResult, string>,
  ): Promise<NotificationResult> {
    this.logger.log(
      `Processing ${job.data.type} notification for ${job.data.recipient} (attempt ${job.attemptsMade + 1})`,
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
  onCompleted(job: Job<NotificationJobData, NotificationResult>) {
    this.logger.log(
      `Notification job ${job.id} for ${job.data.recipient} completed successfully`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `Notification job ${job.id} for ${job.data.recipient} failed: ${error.message}`,
      );
    } else {
      this.logger.error(`Notification job failed: ${error.message}`);
    }
  }
}
