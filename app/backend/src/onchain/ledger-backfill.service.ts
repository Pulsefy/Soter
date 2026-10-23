import {
  Injectable,
  Logger,
  ConflictException,
  NotImplementedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  OnChainLedgerEntry,
  StellarLedgerSource,
} from './stellar-ledger-source';

export interface BackfillJobData {
  startLedger: number;
  endLedger: number;
  campaignId?: string;
  batchSize: number;
  checkpointId: string;
  dryRun?: boolean;
}

export interface BackfillResult {
  jobId: string;
  checkpointId: string;
  jobKey: string;
  startLedger: number;
  endLedger: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  processedCount: number;
  skippedCount: number;
  errorCount: number;
  totalCount: number;
  resumeFrom?: number;
  dryRun?: boolean;
}

export interface DryRunResult {
  jobId: string;
  jobKey: string;
  startLedger: number;
  endLedger: number;
  campaignId?: string;
  status: 'dry-run';
  totalCount: number;
  wouldCreate: number;
  wouldSkip: number;
  unattributable: number;
  countsByEventType: Record<string, number>;
  sampleRecords: Array<{
    id: string;
    ledger: number;
    eventType: string;
    amount: number;
    txHash: string;
    packageId?: string;
  }>;
}

/**
 * Builds a deterministic job key for a backfill range so that re-triggering
 * the same range either resumes an existing run or is rejected when one is
 * already in progress.
 */
function buildJobKey(
  startLedger: number,
  endLedger: number,
  campaignId?: string,
): string {
  const suffix = campaignId ? `:${campaignId}` : '';
  return `backfill:${startLedger}:${endLedger}${suffix}`;
}

@Injectable()
export class LedgerBackfillService {
  private readonly logger = new Logger(LedgerBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
    private readonly ledgerSource: StellarLedgerSource,
  ) {}

  /**
   * Perform a dry-run backfill to preview what would be created/updated.
   *
   * Runs the same detection logic as the real backfill but does not persist
   * anything. Returns counts by entity type and a sample of affected records.
   *
   * Refuses to run when no live on-chain source is configured for the same
   * reason as triggerBackfill: a dry-run with nothing to copy would report
   * zero movements, which is indistinguishable from a genuinely empty range.
   */
  async triggerDryRun(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
    batchSize: number = 100,
  ): Promise<DryRunResult> {
    if (!this.ledgerSource.isEnabled()) {
      throw new NotImplementedException(
        `Dry-run is not available against live data: ${this.ledgerSource.describeUnavailable()} ` +
          'Configure AID_ESCROW_CONTRACT_ID with STELLAR_RPC_URL / STELLAR_HORIZON_URL before running dry-run.',
      );
    }

    const jobKey = buildJobKey(startLedger, endLedger, campaignId);
    const totalCount = endLedger - startLedger + 1;

    this.logger.log(
      `[backfill] Dry-run request — range=${startLedger}-${endLedger} key=${jobKey} source=${this.ledgerSource.sourceKind}`,
    );

    let wouldCreate: OnChainLedgerEntry[] = [];
    let wouldSkip = 0;
    let unattributable: OnChainLedgerEntry[] = [];
    const countsByEventType: Record<string, number> = {};

    // Process the range in batches to avoid overwhelming the ledger source.
    for (let ledger = startLedger; ledger <= endLedger; ledger += batchSize) {
      const batchEnd = Math.min(ledger + batchSize - 1, endLedger);

      const result = await this.detectLedgerChanges(
        ledger,
        batchEnd,
        campaignId,
      );
      wouldCreate = wouldCreate.concat(result.wouldCreate);
      wouldSkip += result.wouldSkip;
      unattributable = unattributable.concat(result.unattributable);

      // Aggregate counts by event type.
      for (const entry of result.wouldCreate) {
        countsByEventType[entry.eventType] =
          (countsByEventType[entry.eventType] || 0) + 1;
      }
    }

    // Take a sample of up to 10 records for inspection.
    const sampleRecords = wouldCreate.slice(0, 10).map(entry => ({
      id: entry.id,
      ledger: entry.ledger,
      eventType: entry.eventType,
      amount: entry.amount,
      txHash: entry.txHash,
      packageId: entry.packageId,
    }));

    this.logger.log(
      `[backfill] Dry-run complete — wouldCreate=${wouldCreate.length} wouldSkip=${wouldSkip} unattributable=${unattributable.length}`,
    );

    return {
      jobId: 'dry-run',
      jobKey,
      startLedger,
      endLedger,
      campaignId,
      status: 'dry-run',
      totalCount,
      wouldCreate: wouldCreate.length,
      wouldSkip,
      unattributable: unattributable.length,
      countsByEventType,
      sampleRecords,
    };
  }

  /**
   * Trigger (or resume) a backfill for a ledger range.
   *
   * - If no checkpoint exists, a new one is created and the job is enqueued.
   * - If a `failed` or `cancelled` checkpoint exists, it is reset and re-enqueued
   *   from `lastProcessedLedger` so processing resumes rather than restarts.
   * - If a `running` checkpoint exists, a ConflictException is thrown.
   * - If a `completed` checkpoint exists, the existing result is returned directly.
   *
   * Refuses to start when no live on-chain source is configured: a backfill
   * with nothing to copy would record zero movements and report success, which
   * is indistinguishable from a genuinely complete range.
   */
  async triggerBackfill(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
    batchSize: number = 100,
    triggeredBy?: string,
    dryRun: boolean = false,
  ): Promise<BackfillResult | DryRunResult> {
    // Route to dry-run if requested.
    if (dryRun) {
      return this.triggerDryRun(startLedger, endLedger, campaignId, batchSize);
    }

    if (!this.ledgerSource.isEnabled()) {
      throw new NotImplementedException(
        `Backfill is not available against live data: ${this.ledgerSource.describeUnavailable()} ` +
          'Configure AID_ESCROW_CONTRACT_ID with STELLAR_RPC_URL / STELLAR_HORIZON_URL before backfilling.',
      );
    }

    const jobKey = buildJobKey(startLedger, endLedger, campaignId);
    const totalCount = endLedger - startLedger + 1;

    this.logger.log(
      `[backfill] Trigger request — range=${startLedger}-${endLedger} key=${jobKey} source=${this.ledgerSource.sourceKind}`,
    );

    // Look up an existing checkpoint for this range.
    const existing = await this.prisma.backfillCheckpoint.findUnique({
      where: { jobKey },
    });

    if (existing) {
      if (existing.status === 'running') {
        this.logger.warn(
          `[backfill] Job already running — key=${jobKey} id=${existing.id}`,
        );
        throw new ConflictException(
          `A backfill job for ledger range ${startLedger}-${endLedger} is already running (id: ${existing.id}). ` +
            `Use GET /admin/ledger/backfill/checkpoint/${existing.id} to monitor progress.`,
        );
      }

      if (existing.status === 'completed') {
        this.logger.log(
          `[backfill] Already completed — key=${jobKey} id=${existing.id}`,
        );
        return {
          jobId: 'completed',
          checkpointId: existing.id,
          jobKey,
          startLedger,
          endLedger,
          status: 'completed',
          processedCount: existing.processedCount,
          skippedCount: existing.skippedCount,
          errorCount: existing.errorCount,
          totalCount,
          dryRun: false,
        };
      }

      // Resume from the last successful ledger.
      const resumeFrom = existing.lastProcessedLedger || startLedger;
      this.logger.log(
        `[backfill] Resuming — key=${jobKey} id=${existing.id} from=${resumeFrom} status=${existing.status}`,
      );

      const checkpoint = await this.prisma.backfillCheckpoint.update({
        where: { id: existing.id },
        data: {
          status: 'running',
          lastError: null,
          triggeredBy: triggeredBy ?? existing.triggeredBy,
          startedAt: new Date(),
          completedAt: null,
          heartbeatAt: new Date(),
        },
      });

      const job = await this.onchainQueue.add(
        'ledger-backfill',
        {
          startLedger: resumeFrom,
          endLedger,
          campaignId,
          batchSize,
          checkpointId: checkpoint.id,
        } satisfies BackfillJobData,
        this.jobOptions(),
      );

      return {
        jobId: job.id ?? 'unknown',
        checkpointId: checkpoint.id,
        jobKey,
        startLedger,
        endLedger,
        status: 'queued',
        processedCount: existing.processedCount,
        skippedCount: existing.skippedCount,
        errorCount: existing.errorCount,
        totalCount,
        resumeFrom,
        dryRun: false,
      };
    }

    // Fresh run — create a checkpoint record first.
    const checkpoint = await this.prisma.backfillCheckpoint.create({
      data: {
        jobKey,
        startLedger,
        endLedger,
        lastProcessedLedger: startLedger,
        status: 'running',
        campaignId,
        batchSize,
        triggeredBy,
        heartbeatAt: new Date(),
      },
    });

    this.logger.log(
      `[backfill] Created checkpoint — id=${checkpoint.id} key=${jobKey} range=${startLedger}-${endLedger}`,
    );

    const job = await this.onchainQueue.add(
      'ledger-backfill',
      {
        startLedger,
        endLedger,
        campaignId,
        batchSize,
        checkpointId: checkpoint.id,
      } satisfies BackfillJobData,
      this.jobOptions(),
    );

    this.logger.log(
      `[backfill] Enqueued — jobId=${job.id} checkpointId=${checkpoint.id}`,
    );

    return {
      jobId: job.id ?? 'unknown',
      checkpointId: checkpoint.id,
      jobKey,
      startLedger,
      endLedger,
      status: 'queued',
      processedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      totalCount,
      dryRun: false,
    };
  }

  /**
   * Called by the BullMQ worker to process a backfill job.
   * Updates the checkpoint with progress after every batch so the job can
   * be safely resumed after a crash.
   */
  async processBackfillBatch(data: BackfillJobData): Promise<{
    processed: number;
    skipped: number;
    errors: string[];
  }> {
    const {
      startLedger,
      endLedger,
      campaignId,
      batchSize,
      checkpointId,
      dryRun,
    } = data;
    const errors: string[] = [];
    let processed = 0;
    let skipped = 0;

    this.logger.log(
      `[backfill] Processing — checkpointId=${checkpointId} range=${startLedger}-${endLedger} batchSize=${batchSize} dryRun=${dryRun}`,
    );

    const totalBatches = Math.ceil((endLedger - startLedger + 1) / batchSize);
    let batchIndex = 0;

    for (let ledger = startLedger; ledger <= endLedger; ledger += batchSize) {
      const batchEnd = Math.min(ledger + batchSize - 1, endLedger);
      batchIndex++;

      try {
        const result = await this.processLedgerRange(
          ledger,
          batchEnd,
          campaignId,
        );
        processed += result.processed;
        skipped += result.skipped;
      } catch (error) {
        const errorMsg = `Failed to process ledgers ${ledger}-${batchEnd}: ${(error as Error).message}`;
        this.logger.error(`[backfill] ${errorMsg}`);
        errors.push(errorMsg);
      }

      // Persist progress after every batch (safe resume point).
      await this.prisma.backfillCheckpoint.update({
        where: { id: checkpointId },
        data: {
          lastProcessedLedger: batchEnd,
          processedCount: { increment: processed },
          skippedCount: { increment: skipped },
          errorCount: { increment: errors.length },
          lastError: errors.length > 0 ? errors[errors.length - 1] : undefined,
          heartbeatAt: new Date(),
        },
      });

      // Emit progress log at each batch boundary.
      const percentDone = Math.round((batchIndex / totalBatches) * 100);
      this.logger.log(
        `[backfill] Progress — checkpointId=${checkpointId} batch=${batchIndex}/${totalBatches} (${percentDone}%) ` +
          `processed=${processed} skipped=${skipped} errors=${errors.length} ledger=${batchEnd}/${endLedger}`,
      );
    }

    // Mark as completed or failed based on error count.
    const finalStatus = errors.length > 0 ? 'failed' : 'completed';
    await this.prisma.backfillCheckpoint.update({
      where: { id: checkpointId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });

    this.logger.log(
      `[backfill] Done — checkpointId=${checkpointId} status=${finalStatus} ` +
        `processed=${processed} skipped=${skipped} errors=${errors.length}`,
    );

    return { processed, skipped, errors };
  }

  /**
   * Retrieve status for a backfill job by BullMQ job ID (legacy) or by
   * checkpoint ID.
   */
  async getBackfillStatus(jobId: string): Promise<BackfillResult | null> {
    const job = await this.onchainQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const jobData = job.data as Partial<BackfillJobData>;

    // Fetch live checkpoint if present.
    const checkpoint = jobData.checkpointId
      ? await this.prisma.backfillCheckpoint.findUnique({
          where: { id: jobData.checkpointId },
        })
      : null;

    return {
      jobId: job.id ?? 'unknown',
      checkpointId: checkpoint?.id ?? '',
      jobKey: checkpoint?.jobKey ?? '',
      startLedger: checkpoint?.startLedger ?? jobData.startLedger ?? 0,
      endLedger: checkpoint?.endLedger ?? jobData.endLedger ?? 0,
      status: this.mapJobStateToStatus(state),
      processedCount: checkpoint?.processedCount ?? 0,
      skippedCount: checkpoint?.skippedCount ?? 0,
      errorCount: checkpoint?.errorCount ?? 0,
      totalCount: checkpoint
        ? checkpoint.endLedger - checkpoint.startLedger + 1
        : 0,
    };
  }

  /**
   * Retrieve a checkpoint record directly by its ID.
   */
  async getCheckpoint(checkpointId: string) {
    return this.prisma.backfillCheckpoint.findUnique({
      where: { id: checkpointId },
    });
  }

  /**
   * List recent backfill checkpoints, newest first.
   */
  async listCheckpoints(limit: number = 20) {
    return this.prisma.backfillCheckpoint.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Cancel a running backfill. The job may still complete its current batch;
   * the checkpoint is marked `cancelled` so future enqueueing will offer to
   * resume rather than restart.
   */
  async cancelBackfill(checkpointId: string): Promise<void> {
    const checkpoint = await this.prisma.backfillCheckpoint.findUnique({
      where: { id: checkpointId },
    });

    if (!checkpoint) {
      throw new Error(`Backfill checkpoint ${checkpointId} not found`);
    }

    if (checkpoint.status !== 'running') {
      this.logger.warn(
        `[backfill] Cancel requested for non-running checkpoint — id=${checkpointId} status=${checkpoint.status}`,
      );
      return;
    }

    await this.prisma.backfillCheckpoint.update({
      where: { id: checkpointId },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    this.logger.log(
      `[backfill] Cancelled — checkpointId=${checkpointId} lastProcessedLedger=${checkpoint.lastProcessedLedger}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Detects what would be created/skipped for a ledger range without persisting.
   * This is the shared detection logic used by both dry-run and real runs.
   */
  private async detectLedgerChanges(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
  ): Promise<{
    wouldCreate: OnChainLedgerEntry[];
    wouldSkip: number;
    unattributable: OnChainLedgerEntry[];
  }> {
    const wouldCreate: OnChainLedgerEntry[] = [];
    let wouldSkip = 0;
    const unattributable: OnChainLedgerEntry[] = [];

    // Check for existing ledger entries to ensure idempotency.
    const existingEntries = await this.prisma.balanceLedger.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 86400000), // Last 24 hours
        },
      },
      select: { id: true },
    });

    const existingIds = new Set(existingEntries.map(e => e.id));

    // Genuine on-chain data, read through the shared Stellar client. Throws
    // rather than yielding an empty range, so an unreachable node fails the
    // batch instead of quietly skipping the whole window.
    const ledgerData = await this.ledgerSource.fetchLedgerEntries({
      startLedger,
      endLedger,
    });

    for (const entry of ledgerData) {
      if (existingIds.has(entry.id)) {
        wouldSkip++;
        continue;
      }

      // `BalanceLedger.campaignId` is a required foreign key and the on-chain
      // event stream carries no campaign attribution (see EVENTS.md), so a
      // range backfilled without a campaign cannot be persisted. Surfacing that
      // as an unattributable entry keeps the rows honest instead of inventing a
      // campaign they never belonged to.
      if (!campaignId) {
        unattributable.push(entry);
        continue;
      }

      wouldCreate.push(entry);
    }

    return { wouldCreate, wouldSkip, unattributable };
  }

  private async processLedgerRange(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
  ): Promise<{ processed: number; skipped: number }> {
    const { wouldCreate, wouldSkip, unattributable } =
      await this.detectLedgerChanges(startLedger, endLedger, campaignId);

    if (unattributable.length > 0) {
      throw new Error(
        `Ledgers ${startLedger}-${endLedger}: ${unattributable.length} on-chain movement(s) cannot be stored without a campaignId ` +
          '(BalanceLedger.campaignId is required and the contract event stream carries no campaign attribution). ' +
          'Re-run the backfill with a campaignId.',
      );
    }

    if (wouldCreate.length === 0) {
      this.logger.debug(
        `[backfill] Ledger range ${startLedger}-${endLedger}: 0 new, ${wouldSkip} skipped`,
      );
      return { processed: 0, skipped: wouldSkip };
    }

    if (!campaignId) {
      throw new Error(
        `Ledgers ${startLedger}-${endLedger}: cannot persist ledger entries without a campaignId. ` +
          'Re-run the backfill with a campaignId.',
      );
    }

    // Persist the entries that would be created.
    for (const entry of wouldCreate) {
      await this.prisma.balanceLedger.create({
        data: {
          id: entry.id,
          campaignId,
          claimId: null,
          eventType: entry.eventType,
          amount: entry.amount,
          note: this.buildNote(entry),
          createdAt: entry.createdAt,
        },
      });
    }

    this.logger.debug(
      `[backfill] Ledger range ${startLedger}-${endLedger}: ${wouldCreate.length} new, ${wouldSkip} skipped`,
    );

    return { processed: wouldCreate.length, skipped: wouldSkip };
  }

  /** Provenance string stored alongside every backfilled row. */
  private buildNote(entry: OnChainLedgerEntry): string {
    return (
      `onchain:${entry.source} ledger=${entry.ledger} tx=${entry.txHash}` +
      (entry.packageId ? ` package=${entry.packageId}` : '')
    );
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

  private jobOptions() {
    return {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 10, age: 3600 },
      removeOnFail: { count: 5, age: 7200 },
    };
  }
}
