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
  NotificationBackpressureService,
  ProviderCircuitOpenError,
  notificationBackoffStrategy,
  providerForType,
} from './notification-backpressure.service';
import {
  DeliveryAdapter,
  EMAIL_ADAPTER,
  SMS_ADAPTER,
} from './adapters/delivery-adapter.interface';

@Processor('notifications', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
  // Custom retry backoff (issue #1180): the strategy escalates with the
  // attempt number and with consecutive provider failures, and refuses to
  // become due while the provider circuit is cut off.
  settings: { backoffStrategy: notificationBackoffStrategy },
})
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dlqService: DlqService,
    private readonly metricsService: MetricsService,
    private readonly backpressure: NotificationBackpressureService,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: DeliveryAdapter,
    @Inject(SMS_ADAPTER) private readonly smsAdapter: DeliveryAdapter,
  ) {
    super();
  }

  async process(
    job: Job<NotificationJobData, NotificationResult, string>,
  ): Promise<NotificationResult> {
    const provider = providerForType(job.data.type);

    // Circuit-breaker cutoff (issue #1180): while a provider is mid-outage we
    // fail fast here instead of holding a worker slot open against a dead
    // endpoint. The failure is retried through the escalating backoff, which
    // cannot come due before the probe window opens.
    this.backpressure.assertAttemptAllowed(provider);

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

      this.backpressure.recordSuccess(provider);

      return {
        success: true,
        messageId: deliveryResult.providerMessageId,
      };
    } catch (error) {
      if (error instanceof ProviderCircuitOpenError) {
        // No provider was contacted, so this is not a delivery failure: the
        // circuit breaker held the attempt back on purpose.
        this.logger.warn(
          `Notification job ${job.id} held back by the ${error.provider} circuit breaker: ${error.message}`,
        );
        throw error;
      }

      this.backpressure.recordFailure(provider);
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
    // Issue #1180: an attempt the circuit breaker held back never reached a
    // provider, so it must not be counted as a delivery failure.
    const heldByCircuitBreaker = error instanceof ProviderCircuitOpenError;

    if (job) {
      if (heldByCircuitBreaker) {
        this.logger.warn(
          `Notification job ${job.id} for ${job.data.recipient} paused by the circuit breaker: ${error.message}`,
        );
      } else {
        this.logger.error(
          `Notification job ${job.id} for ${job.data.recipient} failed: ${error.message}`,
        );
        this.metricsService.incrementCallbackFailure(
          'notification_job',
          error.message,
        );
      }
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
    const status = exhausted ? 'dead_letter' : 'enqueued';

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

    if (exhausted && this.metricsService.setNotificationDeadLetterDepth) {
      try {
        const depth = await this.prisma.notificationOutbox.count({
          where: { status: 'dead_letter' },
        });
        this.metricsService.setNotificationDeadLetterDepth(depth);
      } catch (err) {
        this.logger.warn(
          `Could not refresh notification dead-letter depth: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (heldByCircuitBreaker) {
      return;
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
