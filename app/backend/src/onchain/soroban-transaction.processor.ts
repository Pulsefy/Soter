import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { SorobanTransactionService } from './soroban-transaction.service';
import { MetricsService } from '../observability/metrics/metrics.service';

export interface SorobanTransactionJobData {
  transactionId: string;
  operation: 'execute' | 'retry' | 'cleanup';
  correlationId?: string;
}

export interface SorobanTransactionJobResult {
  success: boolean;
  transactionId: string;
  txHash?: string;
  error?: string;
}

@Injectable()
@Processor('soroban-transactions')
export class SorobanTransactionProcessor extends WorkerHost {
  private readonly logger = new Logger(SorobanTransactionProcessor.name);

  constructor(
    private readonly sorobanTransactionService: SorobanTransactionService,
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
          await this.sorobanTransactionService.executeTransaction(transactionId);
          break;
          
        case 'cleanup':
          await this.sorobanTransactionService.markExpiredTransactions();
          break;
          
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      const duration = (Date.now() - startTime) / 1000;

      // Get updated transaction status
      const transaction = await this.sorobanTransactionService.getTransactionStatus(transactionId);
      
      this.metricsService.recordJobProcessingTime(
        'soroban_transaction',
        'success',
        duration,
      );

      return {
        success: true,
        transactionId,
        txHash: transaction?.txHash,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const duration = (Date.now() - startTime) / 1000;

      this.logger.error(
        `Soroban transaction job failed: ${errorMessage}`,
        {
          jobId: job.id,
          transactionId,
          operation,
          error: errorMessage,
          duration,
        },
      );

      this.metricsService.recordJobProcessingTime(
        'soroban_transaction',
        'failed',
        duration,
      );

      this.metricsService.incrementCounter('soroban_transaction_job_failed', {
        operation,
        error: errorMessage.substring(0, 100), // Truncate for metrics
      });

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<SorobanTransactionJobData, SorobanTransactionJobResult>) {
    this.logger.log(`Soroban transaction job completed: ${job.id}`, {
      transactionId: job.data.transactionId,
      operation: job.data.operation,
    });

    this.metricsService.incrementCounter('soroban_transaction_job_completed', {
      operation: job.data.operation,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<SorobanTransactionJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(`Soroban transaction job failed: ${job.id}`, {
        transactionId: job.data.transactionId,
        operation: job.data.operation,
        error: error.message,
        attempts: job.attemptsMade,
      });

      this.metricsService.incrementCounter('soroban_transaction_job_failed_final', {
        operation: job.data.operation,
      });
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
    this.logger.debug(`Soroban transaction job progress: ${job.id} - ${progress}%`, {
      transactionId: job.data.transactionId,
      operation: job.data.operation,
      progress,
    });
  }
}