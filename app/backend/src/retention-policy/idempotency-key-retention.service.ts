import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  IDEMPOTENCY_PURGE_BATCH_SIZE_ENV,
  IDEMPOTENCY_PURGE_MAX_BATCHES_ENV,
  resolveIdempotencyPurgeBatchSize,
  resolveIdempotencyPurgeMaxBatches,
} from './idempotency-key-retention.config';

/** Shape returned by a single purge run. */
export interface IdempotencyKeyPurgeSummary {
  batchesRun: number;
  recordsPurged: number;
  startedAt: Date;
  completedAt: Date;
}

/**
 * Garbage collection for expired IdempotencyKey rows.
 *
 * Expired records are deleted in bounded batches so a single run never loads
 * the full expired set into memory, never issues an unbounded DELETE, and does
 * not hold long-running locks. Expiration semantics live on the row itself
 * (`expiresAt`), so purging is purely physical cleanup: rows that have not
 * been purged yet are still treated as absent by the lookup path.
 */
@Injectable()
export class IdempotencyKeyRetentionService {
  private readonly logger = new Logger(IdempotencyKeyRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Delete expired idempotency keys in bounded batches.
   *
   * @param options override the configured batch size / max batches for a run
   */
  async purgeExpiredKeys(
    options: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<IdempotencyKeyPurgeSummary> {
    const batchSize =
      options.batchSize ??
      resolveIdempotencyPurgeBatchSize(
        this.configService.get<string>(IDEMPOTENCY_PURGE_BATCH_SIZE_ENV),
      );
    const maxBatches =
      options.maxBatches ??
      resolveIdempotencyPurgeMaxBatches(
        this.configService.get<string>(IDEMPOTENCY_PURGE_MAX_BATCHES_ENV),
      );

    const startedAt = new Date();
    let recordsPurged = 0;
    let batchesRun = 0;

    while (batchesRun < maxBatches) {
      const expired = await this.prisma.idempotencyKey.findMany({
        where: { expiresAt: { lte: startedAt } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: batchSize,
      });

      if (expired.length === 0) {
        break;
      }

      const deleted = await this.prisma.idempotencyKey.deleteMany({
        where: { id: { in: expired.map(record => record.id) } },
      });

      recordsPurged += deleted.count;
      batchesRun += 1;

      this.metrics.recordIdempotencyKeysPurged(deleted.count);

      this.logger.log(
        {
          operation: 'idempotency-key-purge',
          batch: batchesRun,
          batchDeleted: deleted.count,
          totalPurged: recordsPurged,
        },
        IdempotencyKeyRetentionService.name,
      );
    }

    const completedAt = new Date();

    this.logger.log(
      {
        operation: 'idempotency-key-purge',
        batchSize,
        batchesRun,
        recordsPurged,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
      IdempotencyKeyRetentionService.name,
    );

    return { batchesRun, recordsPurged, startedAt, completedAt };
  }
}
