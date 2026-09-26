import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
  InitEscrowResult,
  CreateClaimResult,
  DisburseResult,
  AidPackage,
  GetTransactionStatusResult,
} from './onchain.adapter';
import {
  SorobanTransactionStatus,
  SorobanOperationType,
  RetryableErrorType,
  SorobanTransaction,
} from '@prisma/client';

export interface CreateSorobanTransactionParams {
  claimId?: string;
  operation: SorobanOperationType;
  packageId?: string;
  operatorAddress?: string;
  recipientAddress?: string;
  amount?: string;
  tokenAddress?: string;
  correlationId?: string;
  metadata?: Record<string, any>;
  maxAttempts?: number;
  /**
   * Stable key tying one *logical* operation to a single transaction row.
   *
   * A retry after a partial failure must reuse the same row rather than
   * inserting a second attempt, otherwise two rows can each submit the same
   * disbursement (see the double-disbursement guard in `executeTransaction`).
   * Left optional so existing callers keep the old insert-always behaviour.
   */
  idempotencyKey?: string;
}

export interface ExecuteTransactionParams {
  transactionId: string;
  forceRetry?: boolean;
}

/**
 * Whether a stuck transaction is expected to self-heal on a future retry
 * (`retryable`) or can never progress without operator intervention
 * (`terminal`).
 */
export type StuckTransactionClassification = 'retryable' | 'terminal';

export interface StuckTransactionSummary {
  id: string;
  operation: SorobanOperationType;
  status: SorobanTransactionStatus;
  claimId: string | null;
  correlationId: string | null;
  errorType: RetryableErrorType | null;
  lastError: string | null;
  isRetryable: boolean;
  attemptCount: number;
  maxAttempts: number;
  /** How long the transaction has been without progress, in milliseconds. */
  stuckAgeMs: number;
  classification: StuckTransactionClassification;
  updatedAt: Date;
  createdAt: Date;
}

export interface StuckTransactionDetectionResult {
  stuckCount: number;
  retryableCount: number;
  terminalCount: number;
  thresholdMs: number;
  byOperation: Record<string, number>;
  transactions: StuckTransactionSummary[];
}

/**
 * What reconciling one transaction against on-chain state concluded.
 *
 * `confirmed` and `retryable` are the only outcomes that change a row into a
 * state the retry scheduler may act on; everything else deliberately leaves the
 * row alone, because acting on an inconclusive answer is how a disbursement
 * gets submitted twice.
 */
export type ReconciliationOutcome =
  /** On-chain state proves the operation landed; row marked confirmed. */
  | 'confirmed'
  /** On-chain state proves the operation did NOT land; safe to retry. */
  | 'retryable'
  /** On-chain state proves the operation can never succeed; needs an operator. */
  | 'terminal'
  /** On-chain state is inconclusive or still pending; must NOT retry. */
  | 'in_flight'
  /** Nothing on the row identifies an on-chain artefact to check. */
  | 'unavailable'
  /** The status lookup itself failed; must NOT retry on an unknown answer. */
  | 'error';

export interface ReconciliationResult {
  transactionId: string;
  operation: SorobanOperationType;
  claimId: string | null;
  previousStatus: SorobanTransactionStatus;
  outcome: ReconciliationOutcome;
  /** Human-readable evidence for the log line. */
  detail: string;
}

export interface ReconciliationSummary {
  scanned: number;
  confirmed: number;
  retryable: number;
  terminal: number;
  inFlight: number;
  unavailable: number;
  errored: number;
  results: ReconciliationResult[];
}

export interface CreateOrReuseTransactionResult {
  transaction: SorobanTransaction;
  /** False when an existing row was reused via its idempotency key. */
  created: boolean;
}

@Injectable()
export class SorobanTransactionLifecycleService {
  private readonly logger = new Logger(SorobanTransactionLifecycleService.name);

  // Exponential backoff configuration
  private readonly BASE_RETRY_DELAY_MS = 2000; // 2 seconds
  private readonly MAX_RETRY_DELAY_MS = 300000; // 5 minutes
  private readonly BACKOFF_MULTIPLIER = 2;
  private readonly JITTER_MAX_MS = 1000;

  // Transaction expiry time
  private readonly TRANSACTION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Stuck transaction detection threshold (configurable)
  private readonly DEFAULT_STUCK_TRANSACTION_THRESHOLD_MS = 300000; // 5 minutes
  private readonly STUCK_TRANSACTION_THRESHOLD_MS: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {
    this.STUCK_TRANSACTION_THRESHOLD_MS = this.resolveStuckThresholdMs();
  }

  /**
   * Resolve the stuck-transaction threshold from config, falling back to the
   * default when the value is missing, non-numeric, or non-positive. A bogus
   * value must never silently disable detection (e.g. NaN comparisons are
   * always false, which would flag nothing).
   */
  private resolveStuckThresholdMs(): number {
    const raw = this.configService.get<string>(
      'STUCK_TRANSACTION_THRESHOLD_MS',
    );
    const parsed = raw ? parseInt(raw, 10) : NaN;

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return this.DEFAULT_STUCK_TRANSACTION_THRESHOLD_MS;
    }

    return parsed;
  }

  /**
   * Stable idempotency key for a claim's disbursement.
   *
   * Derived from the claim id alone — deliberately *not* from a timestamp or a
   * random value — so the second call for the same claim resolves to the same
   * row instead of inserting a competing attempt.
   */
  static disbursementIdempotencyKey(claimId: string): string {
    return `disburse_claim:${claimId}`;
  }

  /**
   * Create a new Soroban transaction record with lifecycle tracking.
   *
   * Existing callers keep the original contract: a fresh row every call. Pass
   * `idempotencyKey` (or use {@link createOrReuseTransaction}) when a logical
   * operation must map to exactly one row.
   */
  async createTransaction(
    params: CreateSorobanTransactionParams,
  ): Promise<SorobanTransaction> {
    const { transaction } = await this.createOrReuseTransaction(params);
    return transaction;
  }

  /**
   * Create the transaction row, or return the existing one for the same
   * `idempotencyKey`.
   *
   * Two independent callers (a retried HTTP request, an overlapping worker, a
   * double-tapped admin action) can reach `disburse` at the same time. The
   * unique index on `idempotencyKey` decides the winner and the loser is
   * handed the winner's row, so exactly one disbursement transacton exists per
   * claim and the retry path has nothing new to submit.
   */
  async createOrReuseTransaction(
    params: CreateSorobanTransactionParams,
  ): Promise<CreateOrReuseTransactionResult> {
    this.logger.debug('Creating Soroban transaction with lifecycle tracking', {
      claimId: params.claimId,
      operation: params.operation,
      correlationId: params.correlationId,
      idempotencyKey: params.idempotencyKey,
    });

    if (params.idempotencyKey) {
      const existing = await this.prisma.sorobanTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });

      if (existing) {
        this.logger.log(
          'Reusing existing Soroban transaction for idempotency key',
          {
            idempotencyKey: params.idempotencyKey,
            transactionId: existing.id,
            status: existing.status,
          },
        );
        this.metricsService.incrementCounter('soroban_transaction_reused', {
          operation: params.operation,
          status: existing.status,
        });
        return { transaction: existing, created: false };
      }
    }

    let transaction: SorobanTransaction;
    try {
      transaction = await this.prisma.sorobanTransaction.create({
        data: {
          claimId: params.claimId,
          operation: params.operation,
          packageId: params.packageId,
          operatorAddress: params.operatorAddress,
          recipientAddress: params.recipientAddress,
          amount: params.amount,
          tokenAddress: params.tokenAddress,
          correlationId: params.correlationId,
          metadata: params.metadata,
          idempotencyKey: params.idempotencyKey,
          maxAttempts: params.maxAttempts || 5,
          status: SorobanTransactionStatus.pending,
          nextRetryAt: new Date(),
        },
      });
    } catch (error: any) {
      // Lost the race against a concurrent call for the same key: the other
      // row is the canonical attempt, so adopt it rather than surfacing a 500.
      if (params.idempotencyKey && error?.code === 'P2002') {
        const winner = await this.prisma.sorobanTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (winner) {
          this.logger.warn(
            'Concurrent Soroban transaction creation lost the idempotency race; reusing winner',
            {
              idempotencyKey: params.idempotencyKey,
              transactionId: winner.id,
            },
          );
          this.metricsService.incrementCounter(
            'soroban_transaction_idempotency_race',
            { operation: params.operation },
          );
          return { transaction: winner, created: false };
        }
      }
      throw error;
    }

    // Emit metrics for transaction creation
    this.metricsService.incrementCounter('soroban_transaction_created', {
      operation: params.operation,
      claimId: params.claimId || 'none',
    });

    return { transaction, created: true };
  }

  /**
   * Execute a Soroban transaction with comprehensive lifecycle tracking and retry logic
   */
  async executeTransaction(transactionId: string): Promise<void> {
    const transaction = await this.prisma.sorobanTransaction.findUnique({
      where: { id: transactionId },
      include: { claim: true },
    });

    if (!transaction) {
      throw new Error(`Soroban transaction ${transactionId} not found`);
    }

    // -----------------------------------------------------------------------
    // Idempotency / reconciliation guard (Pulsefy/Soter#1175)
    //
    // Two things make a recorded row ambiguous rather than actionable:
    //   * a crash between the adapter submission returning and the local
    //     confirmation write leaves the row in `submitted`;
    //   * an attempt that recorded a `txHash` before failing leaves the hash
    //     on a row that is no longer `submitted`.
    // In both cases the on-chain side may already have moved, so the row is
    // reconciled against the ledger *before* anything is resubmitted. Only a
    // `retryable` verdict — the ledger proves nothing landed — falls through;
    // an inconclusive or already-landed verdict must not submit again.
    //
    // This runs before the retry-budget check on purpose: resolving an
    // ambiguous row is bookkeeping, not a new attempt, so it must still happen
    // once the retry budget is spent.
    // -----------------------------------------------------------------------
    if (
      transaction.status === SorobanTransactionStatus.submitted ||
      transaction.txHash
    ) {
      const reconciliation = await this.reconcileTransaction(transaction);

      this.logger.log('Pre-submit reconciliation for Soroban transaction', {
        transactionId,
        outcome: reconciliation.outcome,
        detail: reconciliation.detail,
      });

      if (reconciliation.outcome !== 'retryable') {
        return;
      }
    }

    // Check if transaction should be retried
    if (
      !transaction.isRetryable ||
      transaction.attemptCount >= transaction.maxAttempts
    ) {
      this.logger.warn('Transaction cannot be retried', {
        transactionId,
        attemptCount: transaction.attemptCount,
        maxAttempts: transaction.maxAttempts,
        isRetryable: transaction.isRetryable,
      });
      return;
    }

    const attemptNumber = transaction.attemptCount + 1;
    const correlationId = transaction.correlationId || `tx-${transactionId}`;

    this.logger.log(`Executing Soroban transaction attempt ${attemptNumber}`, {
      transactionId,
      operation: transaction.operation,
      correlationId,
    });

    const startTime = Date.now();

    try {
      // Update transaction status to submitted
      await this.updateTransactionStatus(
        transactionId,
        SorobanTransactionStatus.submitted,
      );

      // Execute the transaction based on operation type
      let result: InitEscrowResult | CreateClaimResult | DisburseResult;
      switch (transaction.operation) {
        case SorobanOperationType.create_claim:
          result = await this.onchainAdapter.createClaim({
            claimId: transaction.claimId!,
            recipientAddress: transaction.recipientAddress!,
            amount: transaction.amount!,
            tokenAddress: transaction.tokenAddress!,
            expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
          });
          break;

        case SorobanOperationType.disburse_claim:
          {
            const metadata = transaction.metadata as Record<string, any> | null;
            result = await this.onchainAdapter.disburse({
              claimId: transaction.claimId!,
              packageId: transaction.packageId!,
              tokenAddress: transaction.tokenAddress!,
              receiptPointer: metadata?.receiptPointer ?? undefined,
            });
          }
          break;

        case SorobanOperationType.init_escrow:
          result = await this.onchainAdapter.initEscrow({
            adminAddress: transaction.operatorAddress!,
          });
          break;

        default:
          throw new Error(
            `Unsupported operation: ${transaction.operation as string}`,
          );
      }

      // Transaction successful - update with confirmed status
      await this.prisma.sorobanTransaction.update({
        where: { id: transactionId },
        data: {
          status: SorobanTransactionStatus.confirmed,
          txHash: result.transactionHash,
          confirmedAt: new Date(),
          attemptCount: attemptNumber,
          lastRetryAt: new Date(),
          lastError: null,
          errorType: null,
        },
      });

      const duration = (Date.now() - startTime) / 1000;

      // Emit success metrics
      this.metricsService.recordSorobanTransactionLatency(
        transaction.operation,
        'success',
        duration,
      );
      this.metricsService.incrementCounter('soroban_transaction_success', {
        operation: transaction.operation,
        attempt: attemptNumber.toString(),
      });

      this.logger.log('Soroban transaction completed successfully', {
        transactionId,
        txHash: result.transactionHash,
        duration,
        attemptNumber,
      });
    } catch (error) {
      await this.handleTransactionError(
        transactionId,
        error,
        attemptNumber,
        startTime,
      );
    }
  }

  /**
   * Handle transaction errors with intelligent retry classification
   */
  private async handleTransactionError(
    transactionId: string,
    error: any,
    attemptNumber: number,
    startTime: number,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const duration = (Date.now() - startTime) / 1000;

    // Classify error type for retry decisions
    const { errorType, isRetryable } = this.classifyError(errorMessage);

    this.logger.error(`Soroban transaction attempt ${attemptNumber} failed`, {
      transactionId,
      error: errorMessage,
      errorType,
      isRetryable,
      duration,
    });

    const transaction = await this.prisma.sorobanTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error(
        `Transaction ${transactionId} not found during error handling`,
      );
    }

    const shouldRetry = isRetryable && attemptNumber < transaction.maxAttempts;
    let nextRetryAt: Date | null = null;

    if (shouldRetry) {
      // Calculate exponential backoff with jitter
      const baseDelay =
        this.BASE_RETRY_DELAY_MS *
        Math.pow(this.BACKOFF_MULTIPLIER, attemptNumber - 1);
      const jitter = Math.random() * this.JITTER_MAX_MS;
      const delay = Math.min(baseDelay + jitter, this.MAX_RETRY_DELAY_MS);
      nextRetryAt = new Date(Date.now() + delay);

      this.logger.log(`Scheduling retry for transaction ${transactionId}`, {
        attemptNumber,
        nextRetryAt,
        delay: Math.round(delay / 1000) + 's',
      });
    } else {
      this.logger.error(`Transaction ${transactionId} permanently failed`, {
        attemptNumber,
        maxAttempts: transaction.maxAttempts,
        errorType,
        isRetryable,
      });
    }

    // Update transaction record with error details and retry info
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status: shouldRetry
          ? SorobanTransactionStatus.pending
          : SorobanTransactionStatus.failed,
        attemptCount: attemptNumber,
        lastRetryAt: new Date(),
        lastError: errorMessage,
        errorType,
        isRetryable: shouldRetry,
        nextRetryAt,
        failedAt: shouldRetry ? null : new Date(),
      },
    });

    // Emit failure metrics
    this.metricsService.recordSorobanTransactionLatency(
      transaction.operation,
      'failed',
      duration,
    );
    this.metricsService.incrementCounter('soroban_transaction_failure', {
      operation: transaction.operation,
      errorType: errorType || 'unknown',
      attempt: attemptNumber.toString(),
      retryable: isRetryable.toString(),
    });

    if (!shouldRetry) {
      this.metricsService.incrementCounter(
        'soroban_transaction_permanent_failure',
        {
          operation: transaction.operation,
          errorType: errorType || 'unknown',
        },
      );
    }
  }

  /**
   * Classify errors to determine if they are retryable
   */
  private classifyError(errorMessage: string): {
    errorType: RetryableErrorType | null;
    isRetryable: boolean;
  } {
    const lowerError = errorMessage.toLowerCase();

    // Network and timeout errors - retryable
    if (lowerError.includes('timeout') || lowerError.includes('network')) {
      return {
        errorType: RetryableErrorType.network_timeout,
        isRetryable: true,
      };
    }

    // Rate limiting - retryable
    if (
      lowerError.includes('rate limit') ||
      lowerError.includes('too many requests')
    ) {
      return { errorType: RetryableErrorType.rate_limit, isRetryable: true };
    }

    // Network congestion - retryable
    if (lowerError.includes('congestion') || lowerError.includes('busy')) {
      return { errorType: RetryableErrorType.congestion, isRetryable: true };
    }

    // Transaction timing issues - retryable
    if (lowerError.includes('tx_too_late') || lowerError.includes('sequence')) {
      return { errorType: RetryableErrorType.tx_too_late, isRetryable: true };
    }

    // Fee issues - retryable
    if (
      lowerError.includes('insufficient fee') ||
      lowerError.includes('fee too low')
    ) {
      return {
        errorType: RetryableErrorType.insufficient_fee,
        isRetryable: true,
      };
    }

    // Temporary failures - retryable
    if (lowerError.includes('temporary') || lowerError.includes('retry')) {
      return {
        errorType: RetryableErrorType.temporary_failure,
        isRetryable: true,
      };
    }

    // Non-retryable errors (invalid parameters, insufficient balance, contract errors, etc.)
    return { errorType: null, isRetryable: false };
  }

  /**
   * Update transaction status with timestamp tracking
   */
  private async updateTransactionStatus(
    transactionId: string,
    status: SorobanTransactionStatus,
  ): Promise<void> {
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status,
        ...(status === SorobanTransactionStatus.submitted && {
          submittedAt: new Date(),
        }),
        ...(status === SorobanTransactionStatus.confirmed && {
          confirmedAt: new Date(),
        }),
        ...(status === SorobanTransactionStatus.failed && {
          failedAt: new Date(),
        }),
      },
    });
  }

  /**
   * Get transactions ready for retry
   */
  async getRetryableTransactions(): Promise<SorobanTransaction[]> {
    const now = new Date();

    return this.prisma.sorobanTransaction.findMany({
      where: {
        status: SorobanTransactionStatus.pending,
        isRetryable: true,
        nextRetryAt: {
          lte: now,
        },
        attemptCount: {
          lt: this.prisma.sorobanTransaction.fields.maxAttempts,
        },
      },
      orderBy: {
        nextRetryAt: 'asc',
      },
      take: 50, // Limit batch size for processing
    });
  }

  /**
   * Mark expired transactions as expired
   */
  async markExpiredTransactions(): Promise<number> {
    const expiredAt = new Date(Date.now() - this.TRANSACTION_EXPIRY_MS);

    const result = await this.prisma.sorobanTransaction.updateMany({
      where: {
        status: {
          in: [
            SorobanTransactionStatus.pending,
            SorobanTransactionStatus.submitted,
          ],
        },
        createdAt: {
          lt: expiredAt,
        },
      },
      data: {
        status: SorobanTransactionStatus.expired,
        expiredAt: new Date(),
        isRetryable: false,
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Marked ${result.count} transactions as expired`);
      this.metricsService.incrementCounter('soroban_transaction_expired', {
        count: result.count.toString(),
      });
    }

    return result.count;
  }

  /**
   * Classify a stuck transaction as `retryable` (last error was classified as
   * retryable and retry budget remains, so the scheduler will pick it up) or
   * `terminal` (non-retryable, or attempts exhausted — it can never
   * self-heal and needs an operator to take over).
   */
  private classifyStuckTransaction(
    transaction: Pick<
      SorobanTransaction,
      'isRetryable' | 'attemptCount' | 'maxAttempts'
    >,
  ): StuckTransactionClassification {
    const hasRetryBudget = transaction.attemptCount < transaction.maxAttempts;
    return transaction.isRetryable && hasRetryBudget ? 'retryable' : 'terminal';
  }

  /**
   * Detect transactions stuck in a non-terminal state past the configured
   * threshold.
   *
   * A transaction is considered stuck if it is in `pending` or `submitted`
   * status and has not progressed within `STUCK_TRANSACTION_THRESHOLD_MS`.
   * Each stuck transaction is additionally classified as `retryable` (expected
   * to self-heal) or `terminal` (requires operator escalation), see
   * {@link classifyStuckTransaction}. Gauges are re-published on every scan —
   * including zero values — so alerting clears once a backlog recovers.
   */
  async detectStuckTransactions(): Promise<StuckTransactionDetectionResult> {
    const now = Date.now();
    const stuckThreshold = new Date(now - this.STUCK_TRANSACTION_THRESHOLD_MS);

    const stuckTransactions = await this.prisma.sorobanTransaction.findMany({
      where: {
        status: {
          in: [
            SorobanTransactionStatus.pending,
            SorobanTransactionStatus.submitted,
          ],
        },
        updatedAt: {
          lt: stuckThreshold,
        },
      },
      orderBy: {
        updatedAt: 'asc',
      },
    });

    // Seed every label so recovered series fall back to zero instead of
    // leaving a stale non-zero gauge (and a never-clearing alert) behind.
    const byOperation: Record<string, number> = {};
    for (const operation of Object.values(SorobanOperationType)) {
      byOperation[operation] = 0;
    }
    const byClassification: Record<StuckTransactionClassification, number> = {
      retryable: 0,
      terminal: 0,
    };

    const transactions: StuckTransactionSummary[] = stuckTransactions.map(
      tx => {
        const classification = this.classifyStuckTransaction(tx);
        byOperation[tx.operation] += 1;
        byClassification[classification] += 1;

        return {
          id: tx.id,
          operation: tx.operation,
          status: tx.status,
          claimId: tx.claimId,
          correlationId: tx.correlationId,
          errorType: tx.errorType,
          lastError: tx.lastError,
          isRetryable: tx.isRetryable,
          attemptCount: tx.attemptCount,
          maxAttempts: tx.maxAttempts,
          classification,
          stuckAgeMs: now - tx.updatedAt.getTime(),
          updatedAt: tx.updatedAt,
          createdAt: tx.createdAt,
        };
      },
    );

    const stuckCount = transactions.length;
    const retryableCount = byClassification.retryable;
    const terminalCount = byClassification.terminal;

    if (stuckCount > 0) {
      this.logger.warn(`Detected ${stuckCount} stuck Soroban transactions`, {
        thresholdMs: this.STUCK_TRANSACTION_THRESHOLD_MS,
        retryableCount,
        terminalCount,
        operations: transactions.map(tx => tx.operation),
      });
    }

    if (terminalCount > 0) {
      // Unlike retryable ones, these can never recover on their own.
      this.logger.error(
        `Detected ${terminalCount} unrecoverable stuck Soroban transaction(s) requiring operator intervention`,
        {
          transactionIds: transactions
            .filter(tx => tx.classification === 'terminal')
            .map(tx => tx.id),
        },
      );
    }

    this.publishStuckMetrics(stuckCount, byOperation, byClassification);

    return {
      stuckCount,
      retryableCount,
      terminalCount,
      thresholdMs: this.STUCK_TRANSACTION_THRESHOLD_MS,
      byOperation,
      transactions,
    };
  }

  /**
   * Publish the stuck-transaction gauges for every operation type and
   * classification, including zero values, so a cleared backlog resets the
   * previously exported series instead of leaving a stale alert behind.
   */
  private publishStuckMetrics(
    stuckCount: number,
    byOperation: Record<string, number>,
    byClassification: Record<StuckTransactionClassification, number>,
  ): void {
    this.metricsService.setGauge('soroban_transaction_stuck_total', stuckCount);

    for (const [operation, count] of Object.entries(byOperation)) {
      this.metricsService.setGauge(
        'soroban_transaction_stuck_by_operation',
        count,
        {
          operation,
        },
      );
    }

    for (const [classification, count] of Object.entries(byClassification)) {
      this.metricsService.setGauge(
        'soroban_transaction_stuck_by_class',
        count,
        {
          classification,
        },
      );
    }
  }

  /**
   * Reconcile one transaction against authoritative on-chain state
   * (Pulsefy/Soter#1175).
   *
   * The contract is the source of truth — see
   * `app/onchain/contracts/aid_escrow/RECONCILIATION.md`. A disbursement has
   * landed exactly when the package it targets has left `Created`. Two levels
   * of evidence are consulted, strongest first:
   *
   * 1. The stored `txHash`, via `getTransactionStatus`. A definite `succeeded`
   *    or `failed` is conclusive.
   * 2. The target package's status, via `getAidPackage`. `Claimed` proves the
   *    disbursement happened; `Created` proves it did not. Any other package
   *    status (`Expired`/`Cancelled`/`Refunded`) means the contract would
   *    reject a `disburse` with `PackageNotActive`, so a retry can never work.
   *
   * Everything else — a `pending`/`unknown` hash, or a failed lookup — is
   * inconclusive, and an inconclusive answer must never be treated as
   * permission to submit again.
   */
  async reconcileTransaction(
    transaction: Pick<
      SorobanTransaction,
      'id' | 'operation' | 'claimId' | 'status' | 'txHash' | 'packageId'
    >,
  ): Promise<ReconciliationResult> {
    const result = await this.classifyReconciliation(transaction);
    this.recordReconciliation(result);
    return result;
  }

  /**
   * Count one reconciliation outcome.
   *
   * Emitted from {@link reconcileTransaction} rather than from the sweeps, so
   * every reconciliation is counted — including the pre-submit check inside
   * `executeTransaction`, which never reaches a sweep.
   */
  private recordReconciliation(result: ReconciliationResult): void {
    this.metricsService.incrementCounter(
      'soroban_transaction_reconciliation_total',
      { operation: result.operation, outcome: result.outcome },
    );

    if (result.outcome === 'confirmed') {
      // The one that matters: a disbursement that landed without the backend
      // ever recording it. Counting these makes lost-confirmation drift
      // visible instead of silent.
      this.metricsService.incrementCounter(
        'soroban_transaction_reconciliation_recovered',
        { operation: result.operation },
      );
    }
  }

  /**
   * Decide the reconciliation outcome, leaving all metric and gauge emission to
   * the caller so both the guard and the sweep share one code path.
   */
  private async classifyReconciliation(
    transaction: Pick<
      SorobanTransaction,
      'id' | 'operation' | 'claimId' | 'status' | 'txHash' | 'packageId'
    >,
  ): Promise<ReconciliationResult> {
    const base = {
      transactionId: transaction.id,
      operation: transaction.operation,
      claimId: transaction.claimId,
      previousStatus: transaction.status,
    };

    if (transaction.status === SorobanTransactionStatus.confirmed) {
      return { ...base, outcome: 'confirmed', detail: 'already confirmed' };
    }

    if (!this.onchainAdapter) {
      const detail = 'no on-chain adapter available';
      this.logger.warn('Cannot reconcile without an on-chain adapter', {
        transactionId: transaction.id,
      });
      return { ...base, outcome: 'unavailable', detail };
    }

    if (!transaction.txHash && !transaction.packageId) {
      const detail = 'neither a tx hash nor a package id is recorded';
      this.logger.warn(
        'Cannot reconcile a transaction with no on-chain identifier',
        { transactionId: transaction.id },
      );
      return { ...base, outcome: 'unavailable', detail };
    }

    // 1. Hash evidence — the tightest signal when it is available.
    if (transaction.txHash) {
      let onchainStatus: GetTransactionStatusResult;
      try {
        onchainStatus = await this.onchainAdapter.getTransactionStatus({
          hash: transaction.txHash,
        });
      } catch (error) {
        const detail = `status lookup failed for ${transaction.txHash}`;
        this.logger.error(
          'Failed to read transaction status during reconciliation',
          {
            transactionId: transaction.id,
            txHash: transaction.txHash,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return { ...base, outcome: 'error', detail };
      }

      if (onchainStatus.status === 'succeeded') {
        await this.markReconciledConfirmed(transaction.id);
        return {
          ...base,
          outcome: 'confirmed',
          detail: `tx hash ${transaction.txHash} succeeded on-chain`,
        };
      }

      if (onchainStatus.status === 'failed') {
        const detail = `tx hash ${transaction.txHash} failed on-chain${
          onchainStatus.errorMessage ? `: ${onchainStatus.errorMessage}` : ''
        }`;
        await this.markReconciledRetryable(transaction.id, detail);
        return { ...base, outcome: 'retryable', detail };
      }

      const detail = `tx hash ${transaction.txHash} is ${onchainStatus.status}`;
      this.logger.warn('Transaction hash is not yet conclusive on-chain', {
        transactionId: transaction.id,
        txHash: transaction.txHash,
        onchainStatus: onchainStatus.status,
      });
      return { ...base, outcome: 'in_flight', detail };
    }

    // 2. Package evidence — covers the crash window where the submission never
    //    got far enough to return a hash.
    let aidPackage: AidPackage;
    try {
      const result = await this.onchainAdapter.getAidPackage({
        packageId: transaction.packageId!,
      });
      aidPackage = result.package;
    } catch (error) {
      const detail = `package lookup failed for ${transaction.packageId}`;
      this.logger.error(
        'Failed to read package state during reconciliation',
        {
          transactionId: transaction.id,
          packageId: transaction.packageId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return { ...base, outcome: 'error', detail };
    }

    if (aidPackage.status === 'Claimed') {
      await this.markReconciledConfirmed(transaction.id);
      return {
        ...base,
        outcome: 'confirmed',
        detail: `package ${transaction.packageId} is Claimed on-chain`,
      };
    }

    if (aidPackage.status === 'Created') {
      const detail = `package ${transaction.packageId} is still Created on-chain, so no disbursement landed`;
      await this.markReconciledRetryable(transaction.id, detail);
      return { ...base, outcome: 'retryable', detail };
    }

    const detail = `package ${transaction.packageId} is ${aidPackage.status} on-chain and can no longer be disbursed`;
    await this.markReconciledTerminal(transaction.id, detail);
    return { ...base, outcome: 'terminal', detail };
  }

  /**
   * Reconcile every in-flight transaction against on-chain state.
   *
   * Run on scheduler start-up and before each retry sweep, so a worker that
   * restarts mid-disbursement resolves what actually happened to its
   * predecessor's submissions before it considers submitting anything. A
   * crash can therefore never turn into a second disbursement: either the row
   * is proven to have landed (`confirmed`) or it is left untouched pending
   * manual review — never silently resubmitted.
   *
   * Every outcome is logged and counted, so divergence between the local table
   * and the ledger is visible as a metric rather than only in hindsight.
   */
  async reconcileInFlightTransactions(): Promise<ReconciliationSummary> {
    const inFlight = await this.prisma.sorobanTransaction.findMany({
      where: { status: SorobanTransactionStatus.submitted },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });

    const summary: ReconciliationSummary = {
      scanned: inFlight.length,
      confirmed: 0,
      retryable: 0,
      terminal: 0,
      inFlight: 0,
      unavailable: 0,
      errored: 0,
      results: [],
    };

    for (const transaction of inFlight) {
      const result = await this.reconcileTransaction(transaction);
      summary.results.push(result);

      switch (result.outcome) {
        case 'confirmed':
          summary.confirmed += 1;
          break;
        case 'retryable':
          summary.retryable += 1;
          break;
        case 'terminal':
          summary.terminal += 1;
          break;
        case 'in_flight':
          summary.inFlight += 1;
          break;
        case 'unavailable':
          summary.unavailable += 1;
          break;
        case 'error':
          summary.errored += 1;
          break;
      }

      this.logger.log('Reconciled in-flight Soroban transaction', {
        transactionId: result.transactionId,
        operation: result.operation,
        claimId: result.claimId,
        outcome: result.outcome,
        detail: result.detail,
      });
    }

    // Publish the backlog of unresolved in-flight rows on every pass,
    // including zero, so a stale alert clears once reconciliation catches up.
    this.metricsService.setGauge(
      'soroban_transaction_in_flight',
      summary.inFlight + summary.unavailable + summary.errored,
    );

    if (summary.scanned > 0) {
      this.logger.log('In-flight reconciliation pass complete', {
        scanned: summary.scanned,
        confirmed: summary.confirmed,
        retryable: summary.retryable,
        terminal: summary.terminal,
        inFlight: summary.inFlight,
        unavailable: summary.unavailable,
        errored: summary.errored,
      });
    }

    return summary;
  }

  /**
   * On-chain state proved the operation landed even though the row never
   * recorded it. Settle the row so no retry can pick it up.
   */
  private async markReconciledConfirmed(transactionId: string): Promise<void> {
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status: SorobanTransactionStatus.confirmed,
        confirmedAt: new Date(),
        lastRetryAt: new Date(),
        nextRetryAt: null,
        isRetryable: false,
        lastError: null,
        errorType: null,
      },
    });
  }

  /**
   * On-chain state proved the operation did not happen, so the row goes back to
   * `pending` and may be retried safely.
   *
   * `attemptCount` is deliberately not incremented: reconciliation is
   * bookkeeping, not an attempt, and consuming retry budget for it would fail
   * a recoverable disbursement.
   */
  private async markReconciledRetryable(
    transactionId: string,
    detail: string,
  ): Promise<void> {
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status: SorobanTransactionStatus.pending,
        nextRetryAt: new Date(),
        isRetryable: true,
        failedAt: null,
        lastError: `reconciled: ${detail}`,
      },
    });
  }

  /**
   * On-chain state proved the operation can never succeed (the package left
   * `Created` some other way). Stop retrying and hand it to an operator.
   */
  private async markReconciledTerminal(
    transactionId: string,
    detail: string,
  ): Promise<void> {
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status: SorobanTransactionStatus.failed,
        failedAt: new Date(),
        nextRetryAt: null,
        isRetryable: false,
        lastError: `reconciled: ${detail}`,
      },
    });
  }

  /**
   * Get transaction status and details
   */
  async getTransactionStatus(transactionId: string) {
    return this.prisma.sorobanTransaction.findUnique({
      where: { id: transactionId },
      include: {
        claim: {
          select: {
            id: true,
            status: true,
            amount: true,
          },
        },
      },
    });
  }

  /**
   * Get all transactions for a specific claim
   */
  async getClaimTransactions(claimId: string) {
    return this.prisma.sorobanTransaction.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Manually retry a transaction with optional force retry
   */
  async retryTransaction(params: ExecuteTransactionParams): Promise<void> {
    const { transactionId, forceRetry = false } = params;

    const transaction = await this.prisma.sorobanTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (!forceRetry) {
      if (!transaction.isRetryable) {
        throw new Error(`Transaction ${transactionId} is not retryable`);
      }
      if (transaction.attemptCount >= transaction.maxAttempts) {
        throw new Error(
          `Transaction ${transactionId} has exceeded maximum attempts`,
        );
      }
    }

    // Reset for manual retry
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status: SorobanTransactionStatus.pending,
        nextRetryAt: new Date(),
        isRetryable: true,
        ...(forceRetry && { attemptCount: 0 }),
      },
    });

    this.logger.log(`Manual retry scheduled for transaction ${transactionId}`, {
      forceRetry,
      currentAttempts: transaction.attemptCount,
    });

    // Execute the retry immediately
    await this.executeTransaction(transactionId);
  }
}
