import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EvidenceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';

/**
 * Periodically refreshes the evidence-queue SLA gauges so operators can see,
 * from the standard metrics endpoint, how deep the review backlog is and how
 * long the oldest pending item has been waiting (issue #954).
 *
 * The intake-to-decision histogram is recorded inline at the decision points
 * in EvidenceService; only the point-in-time gauges need a periodic refresh.
 */
@Injectable()
export class EvidenceMetricsScheduler {
  private readonly logger = new Logger(EvidenceMetricsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'evidence-queue-sla-metrics',
  })
  async refreshEvidenceQueueSlaMetrics(): Promise<void> {
    try {
      // Queue depth per status. Iterating the enum (not the query result)
      // keeps label cardinality bounded and resets statuses that emptied.
      const grouped = await this.prisma.evidenceQueueItem.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      const countByStatus = new Map<string, number>(
        grouped.map(row => [row.status, row._count._all]),
      );
      for (const status of Object.values(EvidenceStatus)) {
        this.metricsService.setEvidenceQueueDepth(
          status,
          countByStatus.get(status) ?? 0,
        );
      }

      // Age of the oldest item still pending review (0 when none pending).
      const oldestPending = await this.prisma.evidenceQueueItem.findFirst({
        where: { status: EvidenceStatus.pending },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const oldestPendingAgeSeconds = oldestPending
        ? Math.max(0, (Date.now() - oldestPending.createdAt.getTime()) / 1000)
        : 0;
      this.metricsService.setEvidenceQueueOldestPendingAgeSeconds(
        oldestPendingAgeSeconds,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to refresh evidence queue SLA metrics: ${message}`,
      );
    }
  }
}
