import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { Inject } from '@nestjs/common';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import {
  SorobanTransactionStatus,
  SorobanOperationType,
  RetryableErrorType,
} from '@prisma/client';

export interface CreateTransactionParams {
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
}

export interface RetryTransactionParams {
  transactionId: string;
  forceRetry?: boolean;
}

@Injectable()
export class SorobanTransactionService {
  private readonly logger = new Logger(SorobanTransactionService.name);
  
  // Exponential backoff configuration
  private readonly BASE_RETRY_DELAY_MS = 2000; // 2 seconds
  private readonly MAX_RETRY_DELAY_MS = 300000; // 5 minutes
  private readonly BACKOFF_MULTIPLIER = 2;
  private readonly JITTER_MAX_MS = 1000;
  
  // Transaction expiry times
  private readonly TRANSACTION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {}

  /**
   * Create a new Soroban transaction record
   */
  async createTransaction(params: CreateTransactionParams) {
    this.logger.debug('Creating Soroban transaction', {
      claimId: params.claimId,
      operation: params.operation,
      correlationId: params.correlationId,
    });

    const transaction = await this.prisma.sorobanTransaction.create({
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
        maxAttempts: params.maxAttempts || 5,
        status: SorobanTransactionStatus.pending,
        nextRetryAt: new Date(),
      },
    });

    // Emit metrics
    this.metricsService.incrementCounter('soroban_transaction_created', {
      operation: params.operation,
      claimId: params.claimId || 'unknown',
    });

    return transaction;
  }

  /**
   * Execute a Soroban transaction with automatic retry logic
   */
  async executeTransaction(transactionId: string): Promise<void> {
    const transaction = await this.prisma.sorobanTransaction.findUnique({
      where: { id: transactionId },
      include: { claim: true },
    });

    if (!transaction) {
      throw new Error(`Transaction ${transactionId} not found`);
    }

    if (!transaction.isRetryable || transaction.attemptCount >= transaction.maxAttempts) {
      this.logger.warn('Transaction not retryable or max attempts reached', {
        transactionId,
        attemptCount: transaction.attemptCount,
        maxAttempts: transaction.maxAttempts,
        isRetryable: transaction.isRetryable,
      });
      return;
    }

    const attemptNumber = transaction.attemptCount + 1;
    this.logger.log(`Executing Soroban transaction attempt ${attemptNumber}`, {
      transactionId,
      operation: transaction.operation,
      correlationId: transaction.correlationId,
    });

    const startTime = Date.now();

    try {
      // Update status to submitted
      await this.updateTransactionStatus(transactionId, SorobanTransactionStatus.submitted);

      // Execute the transaction based on operation type
      let result;
      switch (transaction.operation) {
        case SorobanOperationType.create_claim:
          result = await this.onchainAdapter.createClaim({
            operatorAddress: transaction.operatorAddress!,
            packageId: transaction.packageId!,
            recipientAddress: transaction.recipientAddress!,
            amount: transaction.amount!,
            tokenAddress: transaction.tokenAddress!,
            expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
          });
          break;
          
        case SorobanOperationType.disburse_claim:
          result = await this.onchainAdapter.disburse({
            packageId: transaction.packageId!,
            operatorAddress: transaction.operatorAddress!,
          });
          break;
          
        case SorobanOperationType.init_escrow:
          result = await this.onchainAdapter.initEscrow({
            adminAddress: transaction.operatorAddress!,
          });
          break;
          
        default:
          throw new Error(`Unsupported operation: ${transaction.operation}`);
      }

      // Transaction successful
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
      await this.handleTransactionError(transactionId, error, attemptNumber, startTime);
    }
  }

  /**
   * Handle transaction errors and determine retry strategy
   */
  private async handleTransactionError(
    transactionId: string,
    error: any,
    attemptNumber: number,
    startTime: number,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const duration = (Date.now() - startTime) / 1000;

    // Classify error type
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
      throw new Error(`Transaction ${transactionId} not found`);
    }

    const shouldRetry = isRetryable && attemptNumber < transaction.maxAttempts;
    let nextRetryAt: Date | null = null;

    if (shouldRetry) {
      // Calculate exponential backoff with jitter
      const baseDelay = this.BASE_RETRY_DELAY_MS * Math.pow(this.BACKOFF_MULTIPLIER, attemptNumber - 1);
      const jitter = Math.random() * this.JITTER_MAX_MS;
      const delay = Math.min(baseDelay + jitter, this.MAX_RETRY_DELAY_MS);
      nextRetryAt = new Date(Date.now() + delay);

      this.logger.log(`Scheduling retry for transaction ${transactionId}`, {
        attemptNumber,
        nextRetryAt,
        delay,
      });
    } else {
      this.logger.error(`Transaction ${transactionId} permanently failed`, {
        attemptNumber,
        maxAttempts: transaction.maxAttempts,
        errorType,
        isRetryable,
      });
    }

    // Update transaction record
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status: shouldRetry ? SorobanTransactionStatus.pending : SorobanTransactionStatus.failed,
        attemptCount: attemptNumber,
        lastRetryAt: new Date(),
        lastError: errorMessage,
        errorType,
        isRetryable: shouldRetry,
        nextRetryAt,
        failedAt: shouldRetry ? null : new Date(),
      },
    });

    // Emit error metrics
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
      this.metricsService.incrementCounter('soroban_transaction_permanent_failure', {
        operation: transaction.operation,
        errorType: errorType || 'unknown',
      });
    }
  }

  /**
   * Classify errors for retry logic
   */
  private classifyError(errorMessage: string): { errorType: RetryableErrorType | null; isRetryable: boolean } {
    const lowerError = errorMessage.toLowerCase();

    // Network and timeout errors
    if (lowerError.includes('timeout') || lowerError.includes('network')) {
      return { errorType: RetryableErrorType.network_timeout, isRetryable: true };
    }

    // Rate limiting
    if (lowerError.includes('rate limit') || lowerError.includes('too many requests')) {
      return { errorType: RetryableErrorType.rate_limit, isRetryable: true };
    }

    // Network congestion
    if (lowerError.includes('congestion') || lowerError.includes('busy')) {
      return { errorType: RetryableErrorType.congestion, isRetryable: true };
    }

    // Transaction timing issues
    if (lowerError.includes('tx_too_late') || lowerError.includes('sequence')) {
      return { errorType: RetryableErrorType.tx_too_late, isRetryable: true };
    }

    // Fee issues
    if (lowerError.includes('insufficient fee') || lowerError.includes('fee too low')) {
      return { errorType: RetryableErrorType.insufficient_fee, isRetryable: true };
    }

    // Temporary failures
    if (lowerError.includes('temporary') || lowerError.includes('retry')) {
      return { errorType: RetryableErrorType.temporary_failure, isRetryable: true };
    }

    // Non-retryable errors (invalid parameters, insufficient balance, etc.)
    return { errorType: null, isRetryable: false };
  }

  /**
   * Update transaction status
   */
  private async updateTransactionStatus(
    transactionId: string,
    status: SorobanTransactionStatus,
  ): Promise<void> {
    await this.prisma.sorobanTransaction.update({
      where: { id: transactionId },
      data: {
        status,
        ...(status === SorobanTransactionStatus.submitted && { submittedAt: new Date() }),
        ...(status === SorobanTransactionStatus.confirmed && { confirmedAt: new Date() }),
        ...(status === SorobanTransactionStatus.failed && { failedAt: new Date() }),
      },
    });
  }

  /**
   * Get transactions ready for retry
   */
  async getRetryableTransactions(): Promise<any[]> {
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
      take: 50, // Limit batch size
    });
  }

  /**
   * Mark expired transactions
   */
  async markExpiredTransactions(): Promise<number> {
    const expiredAt = new Date(Date.now() - this.TRANSACTION_EXPIRY_MS);
    
    const result = await this.prisma.sorobanTransaction.updateMany({
      where: {
        status: {
          in: [SorobanTransactionStatus.pending, SorobanTransactionStatus.submitted],
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
   * Get transaction status and history
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
   * Get transactions for a specific claim
   */
  async getClaimTransactions(claimId: string) {
    return this.prisma.sorobanTransaction.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Retry a specific transaction (manual retry)
   */
  async retryTransaction(params: RetryTransactionParams): Promise<void> {
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
        throw new Error(`Transaction ${transactionId} has exceeded max attempts`);
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

    // Execute immediately
    await this.executeTransaction(transactionId);
  }
}