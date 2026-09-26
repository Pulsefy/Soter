import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BackfillStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface CheckpointData {
  id: string;
  jobKey: string;
  startLedger: number;
  endLedger: number;
  lastProcessedLedger: number;
  status: BackfillStatus;
  processedCount: number;
  errorCount: number;
  campaignId?: string | null;
  batchSize: number;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Builds a deterministic job key from backfill parameters.
 * Used to identify and resume an existing run idempotently.
 */
export function buildJobKey(
  startLedger: number,
  endLedger: number,
  campaignId?: string,
): string {
  const base = `backfill:${startLedger}:${endLedger}`;
  return campaignId ? `${base}:${campaignId}` : base;
}

/**
 * BackfillCheckpointService manages persistent checkpoint records for ledger
 * backfill jobs.  Each unique (startLedger, endLedger, campaignId) tuple maps
 * to exactly one checkpoint row.  The service guarantees idempotent upserts so
 * callers can safely call save() multiple times without creating duplicates.
 */
@Injectable()
export class BackfillCheckpointService {
  private readonly logger = new Logger(BackfillCheckpointService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create or return an existing checkpoint for the given range.
   * If a checkpoint already exists (same jobKey), it is returned as-is so the
   * caller can decide whether to resume or restart.
   */
  async initCheckpoint(
    startLedger: number,
    endLedger: number,
    batchSize: number,
    campaignId?: string,
  ): Promise<CheckpointData> {
    const jobKey = buildJobKey(startLedger, endLedger, campaignId);

    const existing = await this.prisma.backfillCheckpoint.findUnique({
      where: { jobKey },
    });

    if (existing) {
      this.logger.log(
        `Resuming existing checkpoint ${jobKey} (lastProcessedLedger=${existing.lastProcessedLedger}, status=${existing.status})`,
      );
      return existing as CheckpointData;
    }

    this.logger.log(`Creating new checkpoint ${jobKey}`);

    return (await this.prisma.backfillCheckpoint.create({
      data: {
        jobKey,
        startLedger,
        endLedger,
        lastProcessedLedger: startLedger - 1, // nothing processed yet
        status: 'pending',
        processedCount: 0,
        errorCount: 0,
        campaignId: campaignId ?? null,
        batchSize,
      },
    })) as CheckpointData;
  }

  /**
   * Mark the checkpoint as actively running.
   */
  async markRunning(jobKey: string): Promise<CheckpointData> {
    return (await this.prisma.backfillCheckpoint.update({
      where: { jobKey },
      data: { status: 'running' },
    })) as CheckpointData;
  }

  /**
   * Advance the checkpoint after successfully processing a batch.
   * lastProcessedLedger should be the LAST ledger in the batch that succeeded.
   */
  async advanceCheckpoint(
    jobKey: string,
    lastProcessedLedger: number,
    additionalProcessed: number,
    additionalErrors: number,
  ): Promise<CheckpointData> {
    const current = await this.prisma.backfillCheckpoint.findUniqueOrThrow({
      where: { jobKey },
    });

    return (await this.prisma.backfillCheckpoint.update({
      where: { jobKey },
      data: {
        lastProcessedLedger,
        processedCount: current.processedCount + additionalProcessed,
        errorCount: current.errorCount + additionalErrors,
      },
    })) as CheckpointData;
  }

  /**
   * Mark the checkpoint as completed (all ledgers processed).
   */
  async markCompleted(jobKey: string): Promise<CheckpointData> {
    return (await this.prisma.backfillCheckpoint.update({
      where: { jobKey },
      data: { status: 'completed' },
    })) as CheckpointData;
  }

  /**
   * Mark the checkpoint as failed, storing the error message.
   */
  async markFailed(jobKey: string, error: string): Promise<CheckpointData> {
    return (await this.prisma.backfillCheckpoint.update({
      where: { jobKey },
      data: {
        status: 'failed',
        lastError: error.slice(0, 1000),
      },
    })) as CheckpointData;
  }

  /**
   * Load an existing checkpoint by jobKey.  Returns null if not found.
   */
  async getCheckpoint(jobKey: string): Promise<CheckpointData | null> {
    const record = await this.prisma.backfillCheckpoint.findUnique({
      where: { jobKey },
    });
    return record as CheckpointData | null;
  }

  /**
   * List checkpoints with optional status filter (most recent first).
   */
  async listCheckpoints(params?: {
    status?: BackfillStatus;
    campaignId?: string;
    limit?: number;
  }): Promise<CheckpointData[]> {
    const where: Record<string, unknown> = {};
    if (params?.status) where.status = params.status;
    if (params?.campaignId) where.campaignId = params.campaignId;

    const records = await this.prisma.backfillCheckpoint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params?.limit ?? 50,
    });

    return records as CheckpointData[];
  }

  /**
   * Delete a checkpoint record (e.g., cleanup after successful run).
   */
  async deleteCheckpoint(jobKey: string): Promise<void> {
    await this.prisma.backfillCheckpoint
      .delete({ where: { jobKey } })
      .catch(() => {
        // Already gone — that's fine
      });
  }
}
