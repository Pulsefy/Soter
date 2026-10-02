import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { StellarLedgerSource } from './stellar-ledger-source';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  CampaignTokenTotals,
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
} from './onchain.adapter';
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

/** Counter incremented once per campaign/token whose ledger disagrees with the chain. */
export const LEDGER_RECONCILIATION_DISCREPANCY_METRIC =
  'ledger_reconciliation_discrepancy_total';

/** Gauge holding how many discrepancies the most recent balance pass found. */
export const LEDGER_RECONCILIATION_DISCREPANCIES_GAUGE =
  'ledger_reconciliation_discrepancies';

/** Histogram of how long a balance reconciliation pass takes, in seconds. */
export const LEDGER_RECONCILIATION_DURATION_METRIC =
  'ledger_reconciliation_duration_seconds';

/** Default relative tolerance (percent of the on-chain total) applied to a pass. */
export const DEFAULT_BALANCE_TOLERANCE_PERCENT = 0.5;

/** Default absolute tolerance (stroops) applied on top of the relative one. */
export const DEFAULT_BALANCE_TOLERANCE_ABSOLUTE = '0';

/**
 * Audit entity used to persist every reported balance discrepancy so an
 * operator can investigate after the fact without re-deriving the query.
 */
export const LEDGER_RECONCILIATION_AUDIT_ENTITY = 'LedgerBalanceReconciliation';

export type LedgerReconciliationSeverity = 'low' | 'medium' | 'high';

/** A campaign/token unit that the balance reconciliation compares. */
export interface LedgerCampaignTokenPair {
  /** Off-chain campaign id, used verbatim as the contract's `campaign_ref`. */
  campaignId: string;
  /** Token address (SAC id) the campaign's packages were funded in. */
  tokenAddress: string;
}

export interface LedgerBalanceDiscrepancy {
  campaignId: string;
  tokenAddress: string;
  /** On-chain locked total for the campaign/token (stroops) — authoritative. */
  expected: string;
  /** Off-chain `BalanceLedger` net total for the campaign (stroops). */
  actual: string;
  /** `actual - expected`, signed. */
  difference: string;
  differencePercent: number;
  /** Absolute tolerance (stroops) that was applied to this comparison. */
  tolerance: string;
  severity: LedgerReconciliationSeverity;
  /** On-chain cumulative claimed total, included as investigation context. */
  onchainClaimed: string;
  /** Ledger row count backing `actual`, so the query can be re-derived. */
  ledgerEntryCount: number;
}

export interface LedgerReconciliationSkip {
  campaignId: string;
  tokenAddress: string;
  reason: string;
}

export interface LedgerBalanceReconciliationReport {
  runId: string;
  generatedAt: string;
  dryRun: boolean;
  source: 'scheduled' | 'manual';
  tolerancePercent: number;
  toleranceAbsolute: string;
  /** Campaign/token pairs the pass attempted to compare. */
  pairsChecked: number;
  discrepancies: LedgerBalanceDiscrepancy[];
  skipped: LedgerReconciliationSkip[];
  durationMs: number;
  actionable: boolean;
  summary: {
    totalChecked: number;
    totalDiscrepancies: number;
    withinTolerance: number;
    bySeverity: { low: number; medium: number; high: number };
    byCampaign: Record<string, number>;
  };
}

export interface LedgerBalanceReconciliationOptions {
  /** When true the pass reports but never persists or emits metrics. */
  dryRun?: boolean;
  /** Where the pass came from; used in the report and the audit trail. */
  source?: 'scheduled' | 'manual';
  /** Restrict the pass to one campaign. */
  campaignId?: string;
  /** Restrict the pass to one token address. */
  tokenAddress?: string;
  /** Override the configured relative tolerance (percent). */
  tolerancePercent?: number;
  /** Override the configured absolute tolerance (stroops). */
  toleranceAbsolute?: string;
  /** Explicit campaign/token pairs; otherwise they are derived from the database. */
  campaigns?: LedgerCampaignTokenPair[];
}

type PairOutcome =
  | { kind: 'clean' }
  | { kind: 'discrepancy'; discrepancy: LedgerBalanceDiscrepancy }
  | { kind: 'skipped'; reason: string };

@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new Logger(LedgerReconciliationService.name);
  private isBalanceReconciliationRunning = false;
  private lastBalanceReport: LedgerBalanceReconciliationReport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
@Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    @Optional() private readonly auditService?: AuditService,
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

  // ---------------------------------------------------------------------------
  // Balance ledger vs on-chain aggregates reconciliation
  //
  // `BalanceLedger` accumulates fund movements per campaign off-chain while the
  // contract independently tracks locked/claimed totals per campaign *and*
  // token (`get_campaign_token_locked` / `get_campaign_token_claimed`). The
  // methods below compare the two, per campaign/token, on a schedule and on
  // demand, and report every disagreement beyond a configurable tolerance.
  // ---------------------------------------------------------------------------

  /**
   * Scheduled pass: compares the off-chain `BalanceLedger` net total for every
   * campaign against the contract's per-campaign, per-token locked total.
   *
   * Reports discrepancies through the structured report, `logger.warn` and the
   * audit trail — it never silently swallows them and never mutates state.
   */
  @Cron(process.env.LEDGER_RECONCILIATION_CRON || CronExpression.EVERY_HOUR, {
    name: 'ledger-balance-reconciliation',
    timeZone: 'UTC',
  })
  async handleScheduledBalanceReconciliation(): Promise<void> {
    if (!this.isBalanceReconciliationEnabled()) {
      this.logger.debug('Ledger balance reconciliation is disabled');
      return;
    }

    if (this.isBalanceReconciliationRunning) {
      this.logger.debug(
        'Ledger balance reconciliation already in progress, skipping',
      );
      return;
    }

    this.isBalanceReconciliationRunning = true;
    try {
      await this.reconcileBalances({ source: 'scheduled' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Ledger balance reconciliation failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.metricsService.incrementCounter('ledger_reconciliation_run_failed', {
        reason: message.substring(0, 100),
      });
    } finally {
      this.isBalanceReconciliationRunning = false;
    }
  }

  /**
   * Compare and report `BalanceLedger` totals against on-chain totals.
   *
   * Pass `dryRun: true` (or hit the admin endpoint with `dryRun`) to inspect
   * what a pass would report without persisting an audit trail or emitting
   * discrepancy metrics.
   */
  async reconcileBalances(
    options: LedgerBalanceReconciliationOptions = {},
  ): Promise<LedgerBalanceReconciliationReport> {
    const startedAt = Date.now();
    const dryRun = options.dryRun === true;
    const source = options.source ?? 'manual';
    const tolerancePercent = this.resolveTolerancePercent(options);
    const toleranceAbsolute = this.resolveToleranceAbsolute(options);

    const { pairs, skipped } = await this.resolvePairs(options);
    const discrepancies: LedgerBalanceDiscrepancy[] = [];
    let withinTolerance = 0;

    for (const pair of pairs) {
      const outcome = await this.reconcilePair(pair, {
        tolerancePercent,
        toleranceAbsolute,
      });

      switch (outcome.kind) {
        case 'discrepancy':
          discrepancies.push(outcome.discrepancy);
          break;
        case 'skipped':
          skipped.push({ ...pair, reason: outcome.reason });
          break;
        default:
          withinTolerance++;
      }
    }

    const summary = this.buildSummary(discrepancies, withinTolerance);
    const report: LedgerBalanceReconciliationReport = {
      runId: randomUUID(),
      generatedAt: new Date().toISOString(),
      dryRun,
      source,
      tolerancePercent,
      toleranceAbsolute: toleranceAbsolute.toString(),
      pairsChecked: pairs.length,
      discrepancies,
      skipped,
      durationMs: Date.now() - startedAt,
      actionable: summary.bySeverity.high > 0,
      summary,
    };

    this.lastBalanceReport = report;

    if (!dryRun) {
      await this.persistDiscrepancies(report);
      this.publishMetrics(report);
    }

    this.logReport(report);

    return report;
  }

  /** Last balance reconciliation report produced by this process, if any. */
  getLastBalanceReconciliationReport(): LedgerBalanceReconciliationReport | null {
    return this.lastBalanceReport;
  }

  private buildSummary(
    discrepancies: LedgerBalanceDiscrepancy[],
    withinTolerance: number,
  ): LedgerBalanceReconciliationReport['summary'] {
    const bySeverity = { low: 0, medium: 0, high: 0 };
    const byCampaign: Record<string, number> = {};

    for (const d of discrepancies) {
      bySeverity[d.severity]++;
      byCampaign[d.campaignId] = (byCampaign[d.campaignId] ?? 0) + 1;
    }

    return {
      totalChecked: discrepancies.length + withinTolerance,
      totalDiscrepancies: discrepancies.length,
      withinTolerance,
      bySeverity,
      byCampaign,
    };
  }

  private async resolvePairs(
    options: LedgerBalanceReconciliationOptions,
  ): Promise<{
    pairs: LedgerCampaignTokenPair[];
    skipped: LedgerReconciliationSkip[];
  }> {
    const explicit = options.campaigns ?? this.configuredPairs();
    let pairs: LedgerCampaignTokenPair[];
    let skipped: LedgerReconciliationSkip[] = [];

    if (explicit.length > 0) {
      pairs = this.normalizePairs(explicit);
    } else {
      const derived = await this.derivePairsFromLedger();
      pairs = derived.pairs;
      skipped = derived.skipped;
    }

    if (options.campaignId) {
      pairs = pairs.filter(pair => pair.campaignId === options.campaignId);
      skipped = skipped.filter(pair => pair.campaignId === options.campaignId);
    }
    if (options.tokenAddress) {
      pairs = pairs.filter(pair => pair.tokenAddress === options.tokenAddress);
    }

    return { pairs, skipped };
  }

  /**
   * Campaign/token pairs from `LEDGER_RECONCILIATION_CAMPAIGNS` (a JSON array
   * of `{ "campaignId", "tokenAddress" }`), for campaigns whose token cannot be
   * derived from stored Soroban transactions.
   */
  private configuredPairs(): LedgerCampaignTokenPair[] {
    const raw: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_CAMPAIGNS',
    );
    if (typeof raw !== 'string' || raw.trim() === '') {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return this.normalizePairs(
        parsed.filter(
          (entry): entry is LedgerCampaignTokenPair =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as LedgerCampaignTokenPair).campaignId === 'string' &&
            typeof (entry as LedgerCampaignTokenPair).tokenAddress === 'string',
        ),
      );
    } catch (error) {
      this.logger.warn(
        `Ignoring malformed LEDGER_RECONCILIATION_CAMPAIGNS: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private normalizePairs(
    pairs: LedgerCampaignTokenPair[],
  ): LedgerCampaignTokenPair[] {
    const seen = new Set<string>();
    const normalized: LedgerCampaignTokenPair[] = [];

    for (const pair of pairs) {
      const campaignId = pair.campaignId?.trim();
      const tokenAddress = pair.tokenAddress?.trim();
      if (!campaignId || !tokenAddress) {
        continue;
      }
      const key = `${campaignId}::${tokenAddress}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push({ campaignId, tokenAddress });
    }

    return normalized;
  }

  /**
   * Derive campaign/token pairs from the ledger itself plus the token address
   * recorded on the campaign's Soroban transactions. A campaign with ledger
   * rows but no on-chain token reference is reported as skipped rather than
   * guessed at.
   */
  private async derivePairsFromLedger(): Promise<{
    pairs: LedgerCampaignTokenPair[];
    skipped: LedgerReconciliationSkip[];
  }> {
    const ledgerCampaigns = await this.prisma.balanceLedger.findMany({
      distinct: ['campaignId'],
      select: { campaignId: true },
    });

    const transactions = await this.prisma.sorobanTransaction.findMany({
      where: { tokenAddress: { not: null } },
      select: {
        tokenAddress: true,
        claim: { select: { campaignId: true } },
      },
    });

    const tokensByCampaign = new Map<string, Set<string>>();
    for (const tx of transactions) {
      const campaignId = tx.claim?.campaignId;
      const tokenAddress = tx.tokenAddress;
      if (!campaignId || !tokenAddress) {
        continue;
      }
      let tokens = tokensByCampaign.get(campaignId);
      if (!tokens) {
        tokens = new Set<string>();
        tokensByCampaign.set(campaignId, tokens);
      }
      tokens.add(tokenAddress);
    }

    const pairs: LedgerCampaignTokenPair[] = [];
    const skipped: LedgerReconciliationSkip[] = [];

    for (const { campaignId } of ledgerCampaigns) {
      const tokens = tokensByCampaign.get(campaignId);
      if (!tokens || tokens.size === 0) {
        skipped.push({
          campaignId,
          tokenAddress: '',
          reason: 'no_onchain_token_reference',
        });
        continue;
      }
      for (const tokenAddress of tokens) {
        pairs.push({ campaignId, tokenAddress });
      }
    }

    return { pairs, skipped };
  }

  private async reconcilePair(
    pair: LedgerCampaignTokenPair,
    tolerance: { tolerancePercent: number; toleranceAbsolute: bigint },
  ): Promise<PairOutcome> {
    const adapter = this.onchainAdapter;
    if (typeof adapter.getCampaignTokenTotals !== 'function') {
      return {
        kind: 'skipped',
        reason: 'adapter_missing_campaign_token_totals',
      };
    }

    let totals: CampaignTokenTotals;
    try {
      const result = await adapter.getCampaignTokenTotals({
        campaignRef: pair.campaignId,
        tokenAddress: pair.tokenAddress,
      });
      totals = result.totals;
    } catch (error) {
      return {
        kind: 'skipped',
        reason: `onchain_read_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const expected = this.toStroops(totals.totalLocked);
    const onchainClaimed = this.toStroops(totals.totalClaimed);

    const aggregate = await this.prisma.balanceLedger.aggregate({
      _sum: { amount: true },
      where: { campaignId: pair.campaignId },
    });
    const ledgerEntryCount = await this.prisma.balanceLedger.count({
      where: { campaignId: pair.campaignId },
    });
    const actual = this.toStroops(aggregate._sum?.amount ?? 0);

    const difference = actual - expected;
    const threshold = this.thresholdFor(
      expected,
      tolerance.tolerancePercent,
      tolerance.toleranceAbsolute,
    );

    if (this.abs(difference) <= threshold) {
      return { kind: 'clean' };
    }

    return {
      kind: 'discrepancy',
      discrepancy: {
        campaignId: pair.campaignId,
        tokenAddress: pair.tokenAddress,
        expected: expected.toString(),
        actual: actual.toString(),
        difference: difference.toString(),
        differencePercent: this.differencePercent(difference, expected),
        tolerance: threshold.toString(),
        severity: this.severityFor(difference, expected, threshold),
        onchainClaimed: onchainClaimed.toString(),
        ledgerEntryCount,
      },
    };
  }

  private thresholdFor(
    expected: bigint,
    percent: number,
    absolute: bigint,
  ): bigint {
    const basisPoints = BigInt(Math.round(percent * 100));
    const percentPart = (this.abs(expected) * basisPoints) / BigInt(10000);
    return percentPart > absolute ? percentPart : absolute;
  }

  private severityFor(
    difference: bigint,
    expected: bigint,
    threshold: bigint,
  ): LedgerReconciliationSeverity {
    if (expected === BigInt(0)) {
      // A campaign the chain says holds nothing but the ledger credits (or
      // debits) something is always worth escalating.
      return 'high';
    }
    if (threshold === BigInt(0)) {
      return 'high';
    }
    return this.abs(difference) > threshold * BigInt(2) ? 'high' : 'medium';
  }

  private differencePercent(difference: bigint, expected: bigint): number {
    if (expected === BigInt(0)) {
      return difference === BigInt(0) ? 0 : 100;
    }
    const percent = (Number(difference) / Number(expected)) * 100;
    return Number.isFinite(percent) ? Number(percent.toFixed(4)) : 0;
  }

  private toStroops(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? BigInt(Math.round(value)) : BigInt(0);
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      return BigInt(value.trim());
    }
    return BigInt(0);
  }

  private abs(value: bigint): bigint {
    return value < BigInt(0) ? -value : value;
  }

  private resolveTolerancePercent(
    options: LedgerBalanceReconciliationOptions,
  ): number {
    if (options.tolerancePercent !== undefined) {
      return this.parseTolerancePercent(
        options.tolerancePercent,
        DEFAULT_BALANCE_TOLERANCE_PERCENT,
      );
    }
    const configured: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_TOLERANCE_PERCENT',
    );
    return this.parseTolerancePercent(
      configured,
      DEFAULT_BALANCE_TOLERANCE_PERCENT,
    );
  }

  private resolveToleranceAbsolute(
    options: LedgerBalanceReconciliationOptions,
  ): bigint {
    if (options.toleranceAbsolute !== undefined) {
      return this.parseToleranceAbsolute(options.toleranceAbsolute);
    }
    const configured: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_TOLERANCE_ABSOLUTE',
    );
    return this.parseToleranceAbsolute(configured);
  }

  private parseTolerancePercent(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private parseToleranceAbsolute(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value >= BigInt(0) ? value : BigInt(0);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0
        ? BigInt(Math.round(value))
        : BigInt(0);
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return BigInt(value.trim());
    }
    return BigInt(DEFAULT_BALANCE_TOLERANCE_ABSOLUTE);
  }

  private isBalanceReconciliationEnabled(): boolean {
    const raw: unknown = this.configService.get(
      'LEDGER_RECONCILIATION_ENABLED',
      'true',
    );
    if (typeof raw === 'boolean') {
      return raw;
    }
    return String(raw).toLowerCase() !== 'false';
  }

  /**
   * Persist every reported discrepancy as an immutable audit entry carrying the
   * campaign, token, expected and actual totals, so the finding can be
   * investigated without re-running the comparison.
   */
  private async persistDiscrepancies(
    report: LedgerBalanceReconciliationReport,
  ): Promise<void> {
    if (!this.auditService || report.discrepancies.length === 0) {
      return;
    }

    for (const discrepancy of report.discrepancies) {
      try {
        await this.auditService.record({
          actorId: 'system:ledger-reconciliation',
          entity: LEDGER_RECONCILIATION_AUDIT_ENTITY,
          entityId: report.runId,
          action: `balance_discrepancy_${discrepancy.severity}`,
          metadata: {
            campaignId: discrepancy.campaignId,
            tokenAddress: discrepancy.tokenAddress,
            expected: discrepancy.expected,
            actual: discrepancy.actual,
            difference: discrepancy.difference,
            differencePercent: discrepancy.differencePercent,
            tolerance: discrepancy.tolerance,
            onchainClaimed: discrepancy.onchainClaimed,
            ledgerEntryCount: discrepancy.ledgerEntryCount,
            source: report.source,
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to persist reconciliation discrepancy for campaign ${discrepancy.campaignId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private publishMetrics(report: LedgerBalanceReconciliationReport): void {
    for (const discrepancy of report.discrepancies) {
      this.metricsService.incrementCounter(
        LEDGER_RECONCILIATION_DISCREPANCY_METRIC,
        {
          campaign_id: discrepancy.campaignId,
          token_address: discrepancy.tokenAddress,
          severity: discrepancy.severity,
        },
      );
    }

    this.metricsService.setGauge(
      LEDGER_RECONCILIATION_DISCREPANCIES_GAUGE,
      report.discrepancies.length,
    );
    this.metricsService.recordHistogram(
      LEDGER_RECONCILIATION_DURATION_METRIC,
      report.durationMs / 1000,
    );
  }

  private logReport(report: LedgerBalanceReconciliationReport): void {
    const context = `[run=${report.runId} source=${report.source}${
      report.dryRun ? ' dryRun=true' : ''
    }]`;

    if (report.discrepancies.length === 0) {
      this.logger.log(
        `Ledger balance reconciliation clean ${context}: ` +
          `${report.summary.totalChecked} campaign/token pair(s) checked, ` +
          `${report.skipped.length} skipped in ${report.durationMs}ms`,
      );
      return;
    }

    this.logger.warn(
      `Ledger balance reconciliation found ${report.discrepancies.length} ` +
        `discrepanc(ies) ${context} ` +
        `(high=${report.summary.bySeverity.high}, ` +
        `medium=${report.summary.bySeverity.medium}, ` +
        `low=${report.summary.bySeverity.low})`,
    );

    for (const discrepancy of report.discrepancies) {
      this.logger.warn(
        `  [${discrepancy.severity}] campaign=${discrepancy.campaignId} ` +
          `token=${discrepancy.tokenAddress} ` +
          `expected(onchain)=${discrepancy.expected} ` +
          `actual(ledger)=${discrepancy.actual} ` +
          `difference=${discrepancy.difference} ` +
          `tolerance=${discrepancy.tolerance}`,
      );
    }
  }
}
