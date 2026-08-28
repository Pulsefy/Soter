import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NotificationJobData,
  NotificationResult,
  NotificationType,
} from './interfaces/notification-job.interface';
import { PrismaService } from '../prisma/prisma.service';

import { DlqService } from '../jobs/dlq.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { classifyNotificationFailure } from './notification-failure-classifier';
import {
  DeliveryAdapter,
  EMAIL_ADAPTER,
  SMS_ADAPTER,
} from './adapters/delivery-adapter.interface';

@Processor('notifications', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dlqService: DlqService,
    private readonly metricsService: MetricsService,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: DeliveryAdapter,
    @Inject(SMS_ADAPTER) private readonly smsAdapter: DeliveryAdapter,
  ) {
    super();
  }

  async process(
    job: Job<NotificationJobData, NotificationResult, string>,
  ): Promise<NotificationResult> {
    this.logger.log(
      `Processing ${job.data.type} notification for ${job.data.recipient} (attempt ${job.attemptsMade + 1})${job.data.correlationId ? ` [correlationId=${job.data.correlationId}]` : ''}`,
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
      // Select the correct delivery adapter based on notification type
      const adapter =
        job.data.type === NotificationType.EMAIL
          ? this.emailAdapter
          : this.smsAdapter;

      const deliveryResult = await adapter.send({
        recipient: job.data.recipient,
        subject: job.data.subject,
        message: job.data.message,
      });

      if (!deliveryResult.success) {
        throw new Error(deliveryResult.error ?? 'Delivery failed');
      }

      return {
        success: true,
        messageId: deliveryResult.providerMessageId,
      };
    } catch (error) {
      this.logger.error(
        `Notification job ${job.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.metricsService.incrementCallbackFailure(
        'notification_delivery',
        error instanceof Error ? error.message : String(error),
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

    this.metricsService.incrementNotificationDeliveryAttempt(
      job.data.type,
      'success',
    );

    try {
      const startedAt = job.processedOn
        ? new Date(job.processedOn)
        : new Date();
      const completedAt = new Date();
      await this.prisma.notificationDeliveryAttempt.create({
        data: {
          outboxId: job.data.outboxId,
          attemptNumber: job.attemptsMade + 1,
          outcome: 'success',
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      });
    } catch (err) {
      // Swallow — worker events must not throw. The outbox status update
      // above is the source of truth; this is best-effort history.
      this.logger.error(
        `Failed to record delivery attempt for outbox ${job.data.outboxId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `Notification job ${job.id} for ${job.data.recipient} failed: ${error.message}`,
      );
      this.metricsService.incrementCallbackFailure(
        'notification_job',
        error.message,
      );
      await this.dlqService.moveToDlq('notifications', job, error);
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

    const maxAttempts =
      typeof job.opts?.attempts === 'number' ? job.opts.attempts : 1;
    const exhausted = job.attemptsMade >= maxAttempts;
    const status = exhausted ? 'failed' : 'enqueued';

    try {
      await this.prisma.notificationOutbox.update({
        where: { id: job.data.outboxId },
        data: {
          status,
          retryCount: { increment: 1 },
          lastError: error.message,
        },
      });
    } catch (err) {
      // Swallow — worker events must not throw
      this.logger.error(
        `Failed to update outbox record ${job.data.outboxId} to ${status}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const failureCategory = classifyNotificationFailure(error);
    this.metricsService.incrementNotificationDeliveryAttempt(
      job.data.type,
      'failed',
    );
    this.metricsService.incrementNotificationDeliveryFailureByCategory(
      job.data.type,
      failureCategory,
    );

    try {
      const startedAt = job.processedOn
        ? new Date(job.processedOn)
        : new Date();
      const completedAt = new Date();
      await this.prisma.notificationDeliveryAttempt.create({
        data: {
          outboxId: job.data.outboxId,
          attemptNumber: job.attemptsMade,
          outcome: 'failed',
          failureCategory,
          errorMessage: error.message,
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      });
    } catch (err) {
      // Swallow — worker events must not throw. The outbox status update
      // above is the source of truth; this is best-effort history.
      this.logger.error(
        `Failed to record delivery attempt for outbox ${job.data.outboxId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
