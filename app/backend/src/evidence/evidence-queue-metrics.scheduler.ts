import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EvidenceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';

/**
 * Periodically refreshes Evidence Queue SLA gauges (issue #954).
 *
 * Two gauges are polled on a 30-second schedule:
 *   - evidence_queue_depth{status}         – count per EvidenceStatus
 *   - evidence_queue_oldest_pending_age_seconds – age of the oldest non-terminal item
 *
 * The intake-to-decision histogram is NOT driven from here; it is observed
 * inline inside EvidenceService.processUpload() at the moment an item
 * transitions to a terminal status.
 */
@Injectable()
export class EvidenceQueueMetricsScheduler {
  private readonly logger = new Logger(EvidenceQueueMetricsScheduler.name);

  /** Statuses that are still "in-flight" (non-terminal). */
  private static readonly NON_TERMINAL_STATUSES: EvidenceStatus[] = [
    EvidenceStatus.pending,
    EvidenceStatus.uploading,
  ];

  /** All statuses whose depth we want to expose. */
  private static readonly ALL_STATUSES: EvidenceStatus[] = [
    EvidenceStatus.pending,
    EvidenceStatus.uploading,
    EvidenceStatus.completed,
    EvidenceStatus.failed,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async refreshEvidenceQueueMetrics(): Promise<void> {
    try {
      await Promise.all([
        this.refreshQueueDepths(),
        this.refreshOldestPendingAge(),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to refresh evidence queue metrics: ${(err as Error).message}`,
      );
    }
  }

  private async refreshQueueDepths(): Promise<void> {
    const counts = await this.prisma.evidenceQueueItem.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    // Build a lookup so we can zero-fill missing statuses.
    const byStatus = new Map<EvidenceStatus, number>(
      counts.map(row => [row.status, row._count.id]),
    );

    for (const status of EvidenceQueueMetricsScheduler.ALL_STATUSES) {
      this.metrics.setEvidenceQueueDepth(status, byStatus.get(status) ?? 0);
    }
  }

  private async refreshOldestPendingAge(): Promise<void> {
    const oldest = await this.prisma.evidenceQueueItem.findFirst({
      where: {
        status: { in: EvidenceQueueMetricsScheduler.NON_TERMINAL_STATUSES },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    const ageSeconds = oldest
      ? (Date.now() - oldest.createdAt.getTime()) / 1000
      : 0;

    this.metrics.setEvidenceQueueOldestPendingAge(ageSeconds);
  }
}
