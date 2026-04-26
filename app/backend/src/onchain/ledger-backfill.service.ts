import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface BackfillJobData {
  startLedger: number;
  endLedger: number;
  campaignId?: string;
  batchSize: number;
}

export interface BackfillResult {
  jobId: string;
  startLedger: number;
  endLedger: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  processedCount: number;
  totalCount: number;
}

@Injectable()
export class LedgerBackfillService {
  private readonly logger = new Logger(LedgerBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
  ) {}

  async triggerBackfill(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
    batchSize: number = 100,
  ): Promise<BackfillResult> {
    this.logger.log(
      `Triggering backfill for ledgers ${startLedger} to ${endLedger}`,
    );

    const totalCount = endLedger - startLedger + 1;

    const job = await this.onchainQueue.add(
      'ledger-backfill',
      {
        startLedger,
        endLedger,
        campaignId,
        batchSize,
      } as BackfillJobData,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          count: 10,
          age: 3600,
        },
        removeOnFail: {
          count: 5,
          age: 7200,
        },
      },
    );

    return {
      jobId: job.id || 'unknown',
      startLedger,
      endLedger,
      status: 'queued',
      processedCount: 0,
      totalCount,
    };
  }

  async processBackfillBatch(data: BackfillJobData): Promise<{
    processed: number;
    skipped: number;
    errors: string[];
  }> {
    const { startLedger, endLedger, campaignId, batchSize } = data;
    const errors: string[] = [];
    let processed = 0;
    let skipped = 0;

    this.logger.log(
      `Processing backfill batch: ledgers ${startLedger}-${endLedger}`,
    );

    for (let ledger = startLedger; ledger <= endLedger; ledger += batchSize) {
      const batchEnd = Math.min(ledger + batchSize - 1, endLedger);

      try {
        const result = await this.processLedgerRange(
          ledger,
          batchEnd,
          campaignId,
        );
        processed += result.processed;
        skipped += result.skipped;
      } catch (error) {
        const errorMsg = `Failed to process ledgers ${ledger}-${batchEnd}: ${error.message}`;
        this.logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    return { processed, skipped, errors };
  }

  private async processLedgerRange(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
  ): Promise<{ processed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;

    // Check for existing ledger entries to ensure idempotency
    const existingEntries = await this.prisma.balanceLedger.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 86400000), // Last 24 hours
        },
      },
      select: { id: true },
    });

    const existingIds = new Set(existingEntries.map(e => e.id));

    // Simulate fetching ledger data from on-chain
    // In production, this would call the Stellar Horizon API
    const ledgerData = this.fetchLedgerRange(startLedger, endLedger);

    for (const entry of ledgerData) {
      if (existingIds.has(entry.id)) {
        skipped++;
        continue;
      }

      await this.prisma.balanceLedger.create({
        data: {
          id: entry.id,
          campaignId: entry.campaignId || campaignId,
          claimId: entry.claimId,
          eventType: entry.eventType,
          amount: entry.amount,
          note: entry.note,
          createdAt: entry.createdAt,
        },
      });

      processed++;
    }

    this.logger.log(
      `Processed ledger range ${startLedger}-${endLedger}: ${processed} new, ${skipped} skipped`,
    );

    return { processed, skipped };
  }

  private fetchLedgerRange(_startLedger: number, _endLedger: number): any[] {
    // Placeholder for actual Horizon API call
    // In production, this would query the Stellar Horizon API
    return [];
  }

  async getBackfillStatus(jobId: string): Promise<BackfillResult | null> {
    const job = await this.onchainQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress as any;

    return {
      jobId: job.id || 'unknown',
      startLedger: progress?.startLedger || 0,
      endLedger: progress?.endLedger || 0,
      status: this.mapJobStateToStatus(state),
      processedCount: progress?.processed || 0,
      totalCount: progress?.total || 0,
    };
  }

  private mapJobStateToStatus(state: string): BackfillResult['status'] {
    switch (state) {
      case 'active':
        return 'processing';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'queued';
    }
  }
}
