import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface ReconciliationJobData {
  startLedger: number;
  endLedger: number;
  campaignId?: string;
  thresholdPercent: number;
}

export interface ReconciliationDiscrepancy {
  ledger: number;
  type: 'missing' | 'amount_mismatch' | 'count_mismatch';
  expected: any;
  observed: any;
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
  ) {}

  async triggerReconciliation(
    startLedger: number,
    endLedger: number,
    campaignId?: string,
    thresholdPercent: number = 5,
  ): Promise<ReconciliationReport> {
    this.logger.log(
      `Triggering reconciliation for ledgers ${startLedger} to ${endLedger}`,
    );

    const totalLedgers = endLedger - startLedger + 1;

    const job = await this.onchainQueue.add(
      'ledger-reconciliation',
      {
        startLedger,
        endLedger,
        campaignId,
        thresholdPercent,
      } as ReconciliationJobData,
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
        byType: { missing: 0, amount_mismatch: 0, count_mismatch: 0 },
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

    // Fetch on-chain data (simulated - would call Horizon API in production)
    const onChainData = this.fetchOnChainData(startLedger, endLedger);

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

      // Check event type mismatch
      if (onChainEntry.eventType !== storedEntry.eventType) {
        discrepancies.push({
          ledger: onChainEntry.ledger,
          type: 'count_mismatch',
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
      `Reconciliation complete: ${checkedLedgers} ledgers checked, ${summary.totalDiscrepancies} discrepancies found`,
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

  private fetchOnChainData(_startLedger: number, _endLedger: number): any[] {
    // Placeholder for actual Horizon API call
    // In production, this would query the Stellar Horizon API
    return [];
  }

  private calculateSummary(
    discrepancies: ReconciliationDiscrepancy[],
  ): ReconciliationReport['summary'] {
    const summary: ReconciliationReport['summary'] = {
      totalDiscrepancies: discrepancies.length,
      bySeverity: { low: 0, medium: 0, high: 0 },
      byType: { missing: 0, amount_mismatch: 0, count_mismatch: 0 },
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
    const progress = job.progress as any;

    return {
      jobId: job.id || 'unknown',
      startLedger: progress?.startLedger || 0,
      endLedger: progress?.endLedger || 0,
      status: this.mapJobStateToStatus(state),
      totalLedgers: progress?.totalLedgers || 0,
      checkedLedgers: progress?.checkedLedgers || 0,
      discrepancies: progress?.discrepancies || [],
      summary: progress?.summary || {
        totalDiscrepancies: 0,
        bySeverity: { low: 0, medium: 0, high: 0 },
        byType: { missing: 0, amount_mismatch: 0, count_mismatch: 0 },
      },
      actionable: progress?.actionable || false,
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
