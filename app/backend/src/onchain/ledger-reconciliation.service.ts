import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { StellarLedgerSource } from './stellar-ledger-source';

export interface ReconciliationJobData {
  startLedger: number;
  endLedger: number;
  campaignId?: string;
  thresholdPercent: number;
}

export interface ReconciliationDiscrepancy {
  ledger: number;
  type:
    'missing' | 'amount_mismatch' | 'event_type_mismatch' | 'count_mismatch';
  /** Value recorded off-chain. Shape varies by discrepancy type. */
  expected: unknown;
  /** Value observed on-chain. Shape varies by discrepancy type. */
  observed: unknown;
  severity: 'low' | 'medium' | 'high';
}

export interface ReconciliationReport {
  jobId: string;
  startLedger: number;
  endLedger: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  totalLedgers: number;
  checkedLedgers: number;
  discrepancies: ReconciliationDiscrepancy[];
  summary: {
    totalDiscrepancies: number;
    bySeverity: { low: number; medium: number; high: number };
    byType: {
      missing: number;
      amount_mismatch: number;
      event_type_mismatch: number;
      count_mismatch: number;
    };
  };
  actionable: boolean;
}

@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new Logger(LedgerReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
    private readonly ledgerSource: StellarLedgerSource,
  ) {}

  /**
   * Queue a reconciliation over a ledger range.
   *
   * Refuses to enqueue when the backend has no live on-chain source configured.
   * The alternative — queueing a job that will find nothing and report a clean
   * bill of health — is the false assurance this job exists to eliminate, so an
   * operator gets an explicit 501 instead.
   */
  async triggerReconciliation(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
    thresholdPercent: number = 5,
  ): Promise<ReconciliationReport> {
    if (!this.ledgerSource.isEnabled()) {
      throw new NotImplementedException(
        `Reconciliation is not available against live data: ${this.ledgerSource.describeUnavailable()} ` +
          'Configure AID_ESCROW_CONTRACT_ID with STELLAR_RPC_URL / STELLAR_HORIZON_URL before reconciling.',
      );
    }

    this.logger.log(
      `Triggering reconciliation for ledgers ${startLedger} to ${endLedger} via ${this.ledgerSource.sourceKind}`,
    );

    const totalLedgers = endLedger - startLedger + 1;

    const job = await this.onchainQueue.add(
      'ledger-reconciliation',
      {
        startLedger,
        endLedger,
        campaignId,
        thresholdPercent,
      },
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
      totalLedgers,
      checkedLedgers: 0,
      discrepancies: [],
      summary: {
        totalDiscrepancies: 0,
        bySeverity: { low: 0, medium: 0, high: 0 },
        byType: {
          missing: 0,
          amount_mismatch: 0,
          event_type_mismatch: 0,
          count_mismatch: 0,
        },
      },
      actionable: false,
    };
  }

  async processReconciliation(
    data: ReconciliationJobData,
  ): Promise<ReconciliationReport> {
    const { startLedger, endLedger, campaignId, thresholdPercent } = data;
    const discrepancies: ReconciliationDiscrepancy[] = [];
    let checkedLedgers = 0;

    this.logger.log(
      `Processing reconciliation: ledgers ${startLedger}-${endLedger}`,
    );

    // Genuine on-chain data, read through the shared Stellar client. This is
    // the only comparison source; there is no local fallback, so a run either
    // reconciles against the chain or fails.
    const onChainData = await this.ledgerSource.fetchLedgerEntries({
      startLedger,
      endLedger,
    });

    // Fetch stored ledger entries
    const storedEntries = await this.prisma.balanceLedger.findMany({
      where: campaignId ? { campaignId } : undefined,
      orderBy: { createdAt: 'asc' },
    });

    // Compare on-chain vs stored
    for (const onChainEntry of onChainData) {
      checkedLedgers++;

      const storedEntry = storedEntries.find(e => e.id === onChainEntry.id);

      if (!storedEntry) {
        discrepancies.push({
          ledger: onChainEntry.ledger,
          type: 'missing',
          expected: onChainEntry,
          observed: null,
          severity: 'high',
        });
        continue;
      }

      // Check amount mismatch
      const amountDiff = Math.abs(onChainEntry.amount - storedEntry.amount);
      const amountDiffPercent = (amountDiff / onChainEntry.amount) * 100;

      if (amountDiffPercent > thresholdPercent) {
        discrepancies.push({
          ledger: onChainEntry.ledger,
          type: 'amount_mismatch',
          expected: onChainEntry.amount,
          observed: storedEntry.amount,
          severity:
            amountDiffPercent > thresholdPercent * 2 ? 'high' : 'medium',
        });
      }

      // A movement the chain and the store both know about, filed under
      // different classifications, is a real disagreement: the same id cannot
      // legitimately be a lock on one side and a disburse on the other.
      if (onChainEntry.eventType !== storedEntry.eventType) {
        discrepancies.push({
          ledger: onChainEntry.ledger,
          type: 'event_type_mismatch',
          expected: onChainEntry.eventType,
          observed: storedEntry.eventType,
          severity: 'medium',
        });
      }
    }

    // Check for entries in DB that don't exist on-chain
    for (const storedEntry of storedEntries) {
      const onChainEntry = onChainData.find(e => e.id === storedEntry.id);
      if (!onChainEntry) {
        discrepancies.push({
          ledger: -1, // Unknown ledger
          type: 'missing',
          expected: null,
          observed: storedEntry,
          severity: 'medium',
        });
      }
    }

    const summary = this.calculateSummary(discrepancies);

    this.logger.log(
      `Reconciliation complete: ${checkedLedgers} on-chain movements checked, ${summary.totalDiscrepancies} discrepancies found`,
    );

    return {
      jobId: '',
      startLedger,
      endLedger,
      status: 'completed',
      totalLedgers: endLedger - startLedger + 1,
      checkedLedgers,
      discrepancies,
      summary,
      actionable: summary.bySeverity.high > 0 || summary.bySeverity.medium > 5,
    };
  }

  private calculateSummary(
    discrepancies: ReconciliationDiscrepancy[],
  ): ReconciliationReport['summary'] {
    const summary: ReconciliationReport['summary'] = {
      totalDiscrepancies: discrepancies.length,
      bySeverity: { low: 0, medium: 0, high: 0 },
      byType: {
        missing: 0,
        amount_mismatch: 0,
        event_type_mismatch: 0,
        count_mismatch: 0,
      },
    };

    for (const d of discrepancies) {
      summary.bySeverity[d.severity]++;
      summary.byType[d.type]++;
    }

    return summary;
  }

  async getReconciliationStatus(
    jobId: string,
  ): Promise<ReconciliationReport | null> {
    const job = await this.onchainQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    // BullMQ types job.progress as number | object, so narrow before reading.
    const progress: Record<string, unknown> =
      typeof job.progress === 'object' && job.progress !== null
        ? (job.progress as Record<string, unknown>)
        : {};

    return {
      jobId: job.id || 'unknown',
      startLedger: Number(progress.startLedger ?? 0),
      endLedger: Number(progress.endLedger ?? 0),
      status: this.mapJobStateToStatus(state),
      totalLedgers: Number(progress.totalLedgers ?? 0),
      checkedLedgers: Number(progress.checkedLedgers ?? 0),
      discrepancies: Array.isArray(progress.discrepancies)
        ? (progress.discrepancies as ReconciliationDiscrepancy[])
        : [],
      summary: (progress.summary as ReconciliationReport['summary']) ?? {
        totalDiscrepancies: 0,
        bySeverity: { low: 0, medium: 0, high: 0 },
        byType: {
          missing: 0,
          amount_mismatch: 0,
          event_type_mismatch: 0,
          count_mismatch: 0,
        },
      },
      actionable: progress.actionable === true,
    };
  }

  private mapJobStateToStatus(state: string): ReconciliationReport['status'] {
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
