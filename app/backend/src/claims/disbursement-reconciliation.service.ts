import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanTransactionLifecycleService } from '../onchain/soroban-transaction-lifecycle.service';
import { MetricsService } from '../observability/metrics/metrics.service';

export type DisbursementStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'reconciled';

export interface DisbursementAttemptRecord {
  id: string;
  claimId: string;
  idempotencyKey: string;
  status: DisbursementStatus;
  transactionHash: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReconciliationOutcome {
  attemptId: string;
  claimId: string;
  idempotencyKey: string;
  outcome: 'confirmed' | 'not_found' | 'failed' | 'skipped';
  transactionHash?: string;
  details?: string;
}

/**
 * Reconciles in-flight disbursement attempts against actual onchain state.
 *
 * This service is invoked on worker startup (onModuleInit) and on demand. It
 * ensures that any attempt that was submitted but not confirmed locally is
 * resolved against the chain before any retry can happen. This prevents a
 * double-disbursement when the worker crashes between submission and
 * confirmation.
 */
@Injectable()
export class DisbursementReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(DisbursementReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: SorobanTransactionLifecycleService,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const outcomes = await this.reconcileInFlight();
      if (outcomes.length > 0) {
        this.logger.log(
          `Reconciled ${outcomes.length} in-flight disbursement attempt(s) on worker startup`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to reconcile in-flight disbursements on startup',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Reconcile all attempts that are in a non-terminal state ('pending' or
   * 'submitted') against the actual onchain state.
   */
  async reconcileInFlight(): Promise<ReconciliationOutcome[]> {
    const inFlight = await this.prisma.disbursementAttempt.findMany({
      where: { status: { in: ['pending', 'submitted'] } },
      orderBy: { createdAt: 'asc' },
    });

    const outcomes: ReconciliationOutcome[] = [];
    for (const attempt of inFlight) {
      const outcome = await this.reconcileAttempt(attempt);
      outcomes.push(outcome);
      this.recordMetric(outcome);
      this.logOutcome(outcome);
    }
    return outcomes;
  }

  /**
   * Reconcile a single attempt by attempt id. Returns the outcome of the
   * reconciliation.
   */
  async reconcileAttemptId(attemptId: string): Promise<ReconciliationOutcome | null> {
    const attempt = await this.prisma.disbursementAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) {
      return null;
    }
    const outcome = await this.reconcileAttempt(attempt);
    this.recordMetric(outcome);
    this.logOutcome(outcome);
    return outcome;
  }

  private async reconcileAttempt(
    attempt: DisbursementAttemptRecord,
  ): Promise<ReconciliationOutcome> {
    // If we never submitted a transaction, there is nothing to reconcile
    // against the chain. Mark it as skipped so a retry can proceed with the
    // same idempotency key.
    if (!attempt.transactionHash) {
      return {
        attemptId: attempt.id,
        claimId: attempt.claimId,
        idempotencyKey: attempt.idempotencyKey,
        outcome: 'skipped',
        details: 'No transaction hash recorded; safe to retry',
      };
    }

    try {
      const status = await this.lifecycle.getTransactionStatus(
        attempt.transactionHash,
      );

      if (status === 'success') {
        await this.markConfirmed(attempt);
        return {
          attemptId: attempt.id,
          claimId: attempt.claimId,
          idempotencyKey: attempt.idempotencyKey,
          outcome: 'confirmed',
          transactionHash: attempt.transactionHash,
        };
      }

      if (status === 'not_found') {
        // The transaction was never included onchain. We can safely retry
        // with the same idempotency key.
        await this.markFailed(attempt, 'Transaction not found onchain');
        return {
          attemptId: attempt.id,
          claimId: attempt.claimId,
          idempotencyKey: attempt.idempotencyKey,
          outcome: 'not_found',
          transactionHash: attempt.transactionHash,
          details: 'Safe to retry with same idempotency key',
        };
      }

      // Status is 'failed' or any other non-success terminal state.
      await this.markFailed(attempt, `Transaction status: ${status}`);
      return {
        attemptId: attempt.id,
        claimId: attempt.claimId,
        idempotencyKey: attempt.idempotencyKey,
        outcome: 'failed',
        transactionHash: attempt.transactionHash,
        details: `Transaction status: ${status}`,
      };
    } catch (error) {
      // If we can't determine the onchain state, we must not mark the
      // attempt as failed - that would allow a double-disbursement. Leave it
      // in its current state so the next reconciliation attempts again.
      this.logger.warn(`Unable to reconcile attempt ${attempt.id}: ${String(error)}`);
      return {
        attemptId: attempt.id,
        claimId: attempt.claimId,
        idempotencyKey: attempt.idempotencyKey,
        outcome: 'skipped',
        transactionHash: attempt.transactionHash,
        details: `Reconciliation deferred: ${String(error)}`,
      };
    }
  }

  private async markConfirmed(attempt: DisbursementAttemptRecord): Promise<void> {
    await this.prisma.disbursementAttempt.update({
      where: { id: attempt.id },
      data: { status: 'confirmed', lastError: null },
    });
  }

  private async markFailed(
    attempt: DisbursementAttemptRecord,
    reason: string,
  ): Promise<void> {
    await this.prisma.disbursementAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', lastError: reason },
    });
  }

  private recordMetric(outcome: ReconciliationOutcome): void {
    this.metrics.incrementCounter('disbursement_reconciliation_outcomes_total', {
      outcome: outcome.outcome,
    });
  }

  private logOutcome(outcome: ReconciliationOutcome): void {
    const context = {
      attemptId: outcome.attemptId,
      claimId: outcome.claimId,
      idempotencyKey: outcome.idempotencyKey,
      outcome: outcome.outcome,
      transactionHash: outcome.transactionHash,
      details: outcome.details,
    };
    if (outcome.outcome === 'confirmed') {
      this.logger.log(`Disbursement reconciled: ${JSON.stringify(context)}`);
    } else if (outcome.outcome === 'skipped') {
      this.logger.warn(`Disbursement reconciliation skipped: ${JSON.stringify(context)}`);
    } else {
      this.logger.log(`Disbursement reconciliation ${outcome.outcome}: ${JSON.stringify(context)}`);
    }
  }
}
