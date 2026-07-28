import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { SorobanTransactionJobData } from './soroban-transaction.scheduler';

export interface SorobanTransactionJobResult {
  success: boolean;
  transactionId: string;
  txHash?: string;
  error?: string;
}

@Injectable()
@Processor('soroban-transactions', {
  concurrency: 3, // Allow concurrent processing of Soroban transactions
})
export class SorobanTransactionProcessor extends WorkerHost {
  private readonly logger = new Logger(SorobanTransactionProcessor.name);

  constructor(
    private readonly sorobanTransactionService: SorobanTransactionLifecycleService,
    private readonly metricsService: MetricsService,
  ) {
    super();
  }

  async process(
    job: Job<SorobanTransactionJobData, SorobanTransactionJobResult, string>,
  ): Promise<SorobanTransactionJobResult> {
    const { transactionId, operation, correlationId } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `Processing Soroban transaction job: ${operation} for transaction ${transactionId}`,
      {
        jobId: job.id,
        transactionId,
        operation,
        correlationId,
        attempt: job.attemptsMade + 1,
      },
    );

    try {
      switch (operation) {
        case 'execute':
        case 'retry':
          await this.sorobanTransactionService.executeTransaction(
            transactionId,
          );
          break;

        case 'cleanup':
          await this.sorobanTransactionService.markExpiredTransactions();
          break;

        default:
          throw new Error(
            `Unknown Soroban transaction operation: ${operation as string}`,
          );
      }

      const duration = (Date.now() - startTime) / 1000;

      // Get updated transaction status if not cleanup operation
      let txHash: string | undefined;
      if (operation !== 'cleanup') {
        const transaction =
          await this.sorobanTransactionService.getTransactionStatus(
            transactionId,
          );
        txHash = transaction?.txHash || undefined;
      }

      this.metricsService.recordHistogram(
        'soroban_job_processing_duration',
        duration,
        { operation, status: 'success' },
      );

      return {
        success: true,
        transactionId,
        txHash,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const duration = (Date.now() - startTime) / 1000;

      this.logger.error(`Soroban transaction job failed: ${errorMessage}`, {
        jobId: job.id,
        transactionId,
        operation,
        error: errorMessage,
        duration,
      });

      this.metricsService.recordHistogram(
        'soroban_job_processing_duration',
        duration,
        { operation, status: 'failed' },
      );

      this.metricsService.incrementCounter('soroban_transaction_job_failed', {
        operation,
        error: errorMessage.substring(0, 100), // Truncate for metrics
      });

      return {
        success: false,
        transactionId,
        error: errorMessage,
      };
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(
    job: Job<SorobanTransactionJobData, SorobanTransactionJobResult>,
  ) {
    this.logger.log(`Soroban transaction job completed: ${job.id}`, {
      transactionId: job.data.transactionId,
      operation: job.data.operation,
      result: job.returnvalue,
    });

    this.metricsService.incrementCounter('soroban_transaction_job_completed', {
      operation: job.data.operation,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SorobanTransactionJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `Soroban transaction job failed permanently: ${job.id}`,
        {
          transactionId: job.data.transactionId,
          operation: job.data.operation,
          error: error.message,
          attempts: job.attemptsMade,
        },
      );

      this.metricsService.incrementCounter(
        'soroban_transaction_job_failed_final',
        {
          operation: job.data.operation,
        },
      );
    } else {
      this.logger.error(
        `Unknown Soroban transaction job failed: ${error.message}`,
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(job: Job<SorobanTransactionJobData>) {
    this.logger.warn(`Soroban transaction job stalled: ${job.id}`, {
      transactionId: job.data.transactionId,
      operation: job.data.operation,
    });

    this.metricsService.incrementCounter('soroban_transaction_job_stalled', {
      operation: job.data.operation,
    });
  }

  @OnWorkerEvent('progress')
  onProgress(job: Job<SorobanTransactionJobData>, progress: number) {
    this.logger.debug(
      `Soroban transaction job progress: ${job.id} - ${progress}%`,
      {
        transactionId: job.data.transactionId,
        operation: job.data.operation,
        progress,
      },
    );
  }
}
