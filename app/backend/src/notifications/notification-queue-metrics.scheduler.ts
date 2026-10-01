import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MetricsService } from '../observability/metrics/metrics.service';

/**
 * BullMQ states that make up the notification retry queue's depth.
 * `delayed` is the interesting one under a provider outage: it is where the
 * escalating backoff and the circuit-breaker cutoff park jobs instead of
 * letting them consume worker capacity.
 */
const QUEUE_STATES = ['waiting', 'delayed', 'active', 'failed'] as const;

/**
 * Publishes the notification queue depth as the
 * `notification_queue_depth{state}` gauge (issue #1180), so an operator can
 * see the outbox backlog growing during a provider outage without scraping
 * Redis.
 */
@Injectable()
export class NotificationQueueMetricsScheduler {
  private readonly logger = new Logger(NotificationQueueMetricsScheduler.name);

  constructor(
    @Optional()
    @InjectQueue('notifications')
    private readonly notificationsQueue: Queue | undefined,
    private readonly metricsService: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'notification-queue-depth-metrics',
  })
  async refreshQueueDepth(): Promise<void> {
    if (!this.notificationsQueue) return;

    try {
      const counts = await this.notificationsQueue.getJobCounts(
        ...QUEUE_STATES,
      );
      for (const state of QUEUE_STATES) {
        this.metricsService.setGauge(
          'notification_queue_depth',
          counts[state] ?? 0,
          { state },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to refresh notification queue depth: ${message}`,
      );
    }
  }
}
