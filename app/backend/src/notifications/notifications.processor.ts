import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NotificationJobData,
  NotificationResult,
} from './interfaces/notification-job.interface';
import { PrismaService } from '../prisma/prisma.service';

@Processor('notifications', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(
    job: Job<NotificationJobData, NotificationResult, string>,
  ): Promise<NotificationResult> {
    this.logger.log(
      `Processing ${job.data.type} notification for ${job.data.recipient} (attempt ${job.attemptsMade + 1})`,
    );

    // Update outbox record: set lastAttemptAt to mark processing start
    if (job.data.outboxId) {
      try {
        await this.prisma.notificationOutbox.update({
          where: { id: job.data.outboxId },
          data: { lastAttemptAt: new Date() },
        });
      } catch (err) {
        this.logger.warn(
          `Could not update outbox record ${job.data.outboxId} at process start: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Re-throw so BullMQ can retry the job
        throw err;
      }
    } else {
      this.logger.warn(
        `Job ${job.id} has no outboxId — skipping outbox update at process start`,
      );
    }

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
  async onCompleted(job: Job<NotificationJobData, NotificationResult>) {
    this.logger.log(
      `Notification job ${job.id} for ${job.data.recipient} completed successfully`,
    );

    if (!job.data.outboxId) {
      this.logger.warn(
        `Job ${job.id} has no outboxId — skipping outbox update on completion`,
      );
      return;
    }

    try {
      await this.prisma.notificationOutbox.update({
        where: { id: job.data.outboxId },
        data: {
          status: 'sent',
          sentAt: new Date(),
        },
      });
    } catch (err) {
      // Swallow — worker events must not throw
      this.logger.error(
        `Failed to update outbox record ${job.data.outboxId} to sent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `Notification job ${job.id} for ${job.data.recipient} failed: ${error.message}`,
      );
    } else {
      this.logger.error(`Notification job failed: ${error.message}`);
      return;
    }

    if (!job.data.outboxId) {
      this.logger.warn(
        `Job ${job.id} has no outboxId — skipping outbox update on failure`,
      );
      return;
    }

    try {
      await this.prisma.notificationOutbox.update({
        where: { id: job.data.outboxId },
        data: {
          status: 'failed',
          retryCount: { increment: 1 },
          lastError: error.message,
        },
      });
    } catch (err) {
      // Swallow — worker events must not throw
      this.logger.error(
        `Failed to update outbox record ${job.data.outboxId} to failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
