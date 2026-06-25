import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SorobanTransactionService } from './soroban-transaction.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { SorobanTransactionJobData } from './soroban-transaction.processor';

@Injectable()
export class SorobanTransactionScheduler {
  private readonly logger = new Logger(SorobanTransactionScheduler.name);
  private isProcessingRetries = false;
  private isProcessingCleanup = false;

  constructor(
    @InjectQueue('soroban-transactions')
    private readonly sorobanTransactionQueue: Queue<SorobanTransactionJobData>,
    private readonly sorobanTransactionService: SorobanTransactionService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Schedule retryable transactions every 30 seconds
   */
  @Cron('*/30 * * * * *', {
    name: 'schedule-soroban-retries',
    timeZone: 'UTC',
  })
  async scheduleRetryableTransactions() {
    if (this.isProcessingRetries) {
      this.logger.debug('Retry processing already in progress, skipping');
      return;
    }

    this.isProcessingRetries = true;
    const startTime = Date.now();

    try {
      const retryableTransactions = await this.sorobanTransactionService.getRetryableTransactions();

      if (retryableTransactions.length === 0) {
        this.logger.debug('No retryable transactions found');
        return;
      }

      this.logger.log(`Found ${retryableTransactions.length} retryable transactions`);

      // Schedule jobs for each retryable transaction
      const jobPromises = retryableTransactions.map(async (transaction) => {
        const jobData: SorobanTransactionJobData = {
          transactionId: transaction.id,
          operation: 'retry',
          correlationId: transaction.correlationId,
        };

        // Calculate delay based on nextRetryAt
        const delay = Math.max(0, new Date(transaction.nextRetryAt).getTime() - Date.now());

        return this.sorobanTransactionQueue.add(
          `retry-${transaction.id}`,
          jobData,
          {
            delay,
            attempts: 3, // Job-level retries for the scheduler itself
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: 100, // Keep last 100 completed jobs
            removeOnFail: 50, // Keep last 50 failed jobs
          },
        );
      });

      await Promise.all(jobPromises);

      const duration = (Date.now() - startTime) / 1000;

      this.logger.log(
        `Scheduled ${retryableTransactions.length} transaction retries in ${duration}s`,
      );

      // Emit metrics
      this.metricsService.incrementCounter('soroban_transaction_retries_scheduled', {
        count: retryableTransactions.length.toString(),
      });

      this.metricsService.recordHistogram('soroban_retry_scheduling_duration', duration);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to schedule retryable transactions: ${errorMessage}`, {
        error: errorMessage,
      });

      this.metricsService.incrementCounter('soroban_retry_scheduling_failed', {
        error: errorMessage.substring(0, 100),
      });
    } finally {
      this.isProcessingRetries = false;
    }
  }

  /**
   * Clean up expired transactions every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'cleanup-expired-transactions',
    timeZone: 'UTC',
  })
  async cleanupExpiredTransactions() {
    if (this.isProcessingCleanup) {
      this.logger.debug('Cleanup processing already in progress, skipping');
      return;
    }

    this.isProcessingCleanup = true;
    const startTime = Date.now();

    try {
      const jobData: SorobanTransactionJobData = {
        transactionId: 'cleanup', // Special identifier for cleanup jobs
        operation: 'cleanup',
        correlationId: `cleanup-${Date.now()}`,
      };

      await this.sorobanTransactionQueue.add('cleanup-expired', jobData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      const duration = (Date.now() - startTime) / 1000;

      this.logger.debug(`Scheduled expired transaction cleanup in ${duration}s`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to schedule cleanup job: ${errorMessage}`, {
        error: errorMessage,
      });

      this.metricsService.incrementCounter('soroban_cleanup_scheduling_failed', {
        error: errorMessage.substring(0, 100),
      });
    } finally {
      this.isProcessingCleanup = false;
    }
  }

  /**
   * Queue status health check every minute
   */
  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'soroban-queue-health-check',
    timeZone: 'UTC',
  })
  async healthCheck() {
    try {
      const waiting = await this.sorobanTransactionQueue.getWaiting();
      const active = await this.sorobanTransactionQueue.getActive();
      const completed = await this.sorobanTransactionQueue.getCompleted();
      const failed = await this.sorobanTransactionQueue.getFailed();
      const delayed = await this.sorobanTransactionQueue.getDelayed();

      // Emit queue metrics
      this.metricsService.setGauge('soroban_queue_waiting', waiting.length);
      this.metricsService.setGauge('soroban_queue_active', active.length);
      this.metricsService.setGauge('soroban_queue_completed', completed.length);
      this.metricsService.setGauge('soroban_queue_failed', failed.length);
      this.metricsService.setGauge('soroban_queue_delayed', delayed.length);

      // Log warnings for concerning queue states
      if (waiting.length > 100) {
        this.logger.warn(`High number of waiting Soroban transaction jobs: ${waiting.length}`);
      }

      if (failed.length > 50) {
        this.logger.warn(`High number of failed Soroban transaction jobs: ${failed.length}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Soroban queue health check failed: ${errorMessage}`);

      this.metricsService.incrementCounter('soroban_queue_health_check_failed');
    }
  }

  /**
   * Manually schedule a transaction for immediate execution
   */
  async scheduleTransaction(
    transactionId: string,
    options: {
      delay?: number;
      priority?: number;
      correlationId?: string;
    } = {},
  ) {
    const jobData: SorobanTransactionJobData = {
      transactionId,
      operation: 'execute',
      correlationId: options.correlationId,
    };

    const job = await this.sorobanTransactionQueue.add(
      `execute-${transactionId}`,
      jobData,
      {
        delay: options.delay || 0,
        priority: options.priority || 0,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(`Scheduled transaction ${transactionId} for execution`, {
      jobId: job.id,
      delay: options.delay,
      priority: options.priority,
    });

    return job;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    return {
      waiting: (await this.sorobanTransactionQueue.getWaiting()).length,
      active: (await this.sorobanTransactionQueue.getActive()).length,
      completed: (await this.sorobanTransactionQueue.getCompleted()).length,
      failed: (await this.sorobanTransactionQueue.getFailed()).length,
      delayed: (await this.sorobanTransactionQueue.getDelayed()).length,
    };
  }
}