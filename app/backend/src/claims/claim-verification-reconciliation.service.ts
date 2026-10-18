import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimStatus } from '@prisma/client';

import { MetricsService } from '../observability/metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClaimStatusSnapshot,
  ClaimVerificationDrift,
  ClaimVerificationStateService,
  RECONCILED_CLAIM_STATUSES,
} from './claim-verification-state.service';

/**
 * Counter incremented once per claim whose status disagrees with its
 * verification record, labelled with the drift kind and the claim status.
 */
export const CLAIM_VERIFICATION_DRIFT_METRIC = 'claim_verification_drift_total';

/**
 * Gauge holding how many drifted claims the most recent scan found.
 */
export const CLAIM_VERIFICATION_DRIFT_COUNT_GAUGE =
  'claim_verification_drift_count';

export const DEFAULT_RECONCILIATION_MAX_CLAIMS = 1000;

export interface ClaimVerificationDriftEntry {
  claimId: string;
  claimStatus: ClaimStatus;
  kind: ClaimVerificationDrift;
  verificationScore: number | null;
}

export interface ClaimVerificationReconciliationReport {
  scanned: number;
  driftCount: number;
  drift: ClaimVerificationDriftEntry[];
  durationMs: number;
}

/**
 * Reconciliation between claim status and verification records.
 *
 * The pipeline writes a claim's status and its verification record as two
 * separate statements, so a crashed worker, a retried job or an interrupted
 * deploy can leave a claim claiming a verification that never passed. This job
 * re-reads both halves through `ClaimVerificationStateService` - the single
 * source of truth - reports every disagreement, and exports it as a metric.
 * It never repairs: an operator decides what the claim should say.
 */
@Injectable()
export class ClaimVerificationReconciliationService {
  private readonly logger = new Logger(
    ClaimVerificationReconciliationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly claimVerificationState: ClaimVerificationStateService,
    private readonly metricsService: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleClaimVerificationReconciliation(): Promise<void> {
    try {
      const report = await this.reconcile();

      if (report.driftCount > 0) {
        const summary = report.drift
          .map(entry => `${entry.claimId}=${entry.kind}`)
          .join(', ');

        this.logger.warn(
          `Claim/verification reconciliation found ${report.driftCount} ` +
            `drifted claim(s) of ${report.scanned} scanned in ` +
            `${report.durationMs}ms: ${summary}`,
        );
        return;
      }

      this.logger.log(
        `Claim/verification reconciliation clean ` +
          `(${report.scanned} claim(s) scanned in ${report.durationMs}ms)`,
      );
    } catch (error) {
      this.logger.error(
        'Claim/verification reconciliation failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Scan claims for a status/verification disagreement.
   *
   * Reports only - see the class comment. Returns the report so callers (and
   * tests) can assert on it instead of parsing logs.
   */
  async reconcile(
    options: {
      maxClaims?: number;
      statuses?: ClaimStatus[];
    } = {},
  ): Promise<ClaimVerificationReconciliationReport> {
    const startedAt = Date.now();
    const maxClaims = options.maxClaims ?? DEFAULT_RECONCILIATION_MAX_CLAIMS;

    const claims: ClaimStatusSnapshot[] = await this.prisma.claim.findMany({
      where: {
        deletedAt: null,
        status: { in: options.statuses ?? RECONCILED_CLAIM_STATUSES },
      },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'desc' },
      take: maxClaims,
    });

    const states = await this.claimVerificationState.getStates(claims);

    const drift: ClaimVerificationDriftEntry[] = [];
    for (const state of states) {
      if (!state.drift) {
        continue;
      }

      drift.push({
        claimId: state.claimId,
        claimStatus: state.claimStatus,
        kind: state.drift,
        verificationScore: state.record?.score ?? null,
      });

      this.metricsService.incrementCounter(CLAIM_VERIFICATION_DRIFT_METRIC, {
        kind: state.drift,
        claim_status: state.claimStatus,
      });
    }

    this.metricsService.setGauge(
      CLAIM_VERIFICATION_DRIFT_COUNT_GAUGE,
      drift.length,
    );

    return {
      scanned: states.length,
      driftCount: drift.length,
      drift,
      durationMs: Date.now() - startedAt,
    };
  }
}
