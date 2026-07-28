import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { MetricsService } from '../observability/metrics/metrics.service';

export interface SorobanTransactionJobData {
  transactionId: string;
  operation: 'execute' | 'retry' | 'cleanup';
  correlationId?: string;
}

@Injectable()
export class SorobanTransactionScheduler {
  private readonly logger = new Logger(SorobanTransactionScheduler.name);
  private isProcessingRetries = false;
  private isProcessingCleanup = false;

  constructor(
    @InjectQueue('soroban-transactions')
    private readonly sorobanQueue: Queue<SorobanTransactionJobData>,
    private readonly sorobanTransactionService: SorobanTransactionLifecycleService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Schedule retryable transactions with exponential backoff - every 30 seconds
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
      const retryableTransactions =
        await this.sorobanTransactionService.getRetryableTransactions();

      if (retryableTransactions.length === 0) {
        this.logger.debug('No retryable Soroban transactions found');
        return;
      }

      this.logger.log(
        `Found ${retryableTransactions.length} retryable Soroban transactions`,
      );

      // Schedule jobs for each retryable transaction
      const jobPromises = retryableTransactions.map(async transaction => {
        const jobData: SorobanTransactionJobData = {
          transactionId: transaction.id,
          operation: 'retry',
          correlationId: transaction.correlationId ?? undefined,
        };

        // Calculate delay based on nextRetryAt
        const delay = transaction.nextRetryAt
          ? Math.max(
              0,
              new Date(transaction.nextRetryAt).getTime() - Date.now(),
            )
          : 0;

        return this.sorobanQueue.add(`retry-${transaction.id}`, jobData, {
          delay,
          attempts: 3, // Job-level retries for the scheduler itself
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        });
      });

      await Promise.all(jobPromises);

      const duration = (Date.now() - startTime) / 1000;

      this.logger.log(
        `Scheduled ${retryableTransactions.length} Soroban transaction retries in ${duration}s`,
      );

      // Emit scheduling metrics
      this.metricsService.incrementCounter(
        'soroban_transaction_retries_scheduled',
        {
          count: retryableTransactions.length.toString(),
        },
      );

      this.metricsService.recordHistogram(
        'soroban_retry_scheduling_duration',
        duration,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to schedule retryable Soroban transactions: ${errorMessage}`,
        {
          error: errorMessage,
        },
      );

      this.metricsService.incrementCounter('soroban_retry_scheduling_failed', {
        error: errorMessage.substring(0, 100),
      });
    } finally {
      this.isProcessingRetries = false;
    }
  }

  /**
   * Clean up expired transactions - every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'cleanup-expired-soroban-transactions',
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

      await this.sorobanQueue.add('cleanup-expired', jobData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 10,
        removeOnFail: 5,
      });

      const duration = (Date.now() - startTime) / 1000;

      this.logger.debug(
        `Scheduled Soroban transaction cleanup in ${duration}s`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to schedule Soroban cleanup job: ${errorMessage}`,
        {
          error: errorMessage,
        },
      );

      this.metricsService.incrementCounter(
        'soroban_cleanup_scheduling_failed',
        {
          error: errorMessage.substring(0, 100),
        },
      );
    } finally {
      this.isProcessingCleanup = false;
    }
  }

  /**
   * Queue health check and metrics - every minute
   */
  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'soroban-queue-health-check',
    timeZone: 'UTC',
  })
  async healthCheck() {
    try {
      const waiting = await this.sorobanQueue.getWaiting();
      const active = await this.sorobanQueue.getActive();
      const completed = await this.sorobanQueue.getCompleted();
      const failed = await this.sorobanQueue.getFailed();
      const delayed = await this.sorobanQueue.getDelayed();

      // Emit queue health metrics
      this.metricsService.setGauge('soroban_queue_waiting', waiting.length);
      this.metricsService.setGauge('soroban_queue_active', active.length);
      this.metricsService.setGauge('soroban_queue_completed', completed.length);
      this.metricsService.setGauge('soroban_queue_failed', failed.length);
      this.metricsService.setGauge('soroban_queue_delayed', delayed.length);

      // Log warnings for concerning queue states
      if (waiting.length > 100) {
        this.logger.warn(
          `High number of waiting Soroban transaction jobs: ${waiting.length}`,
        );
      }

      if (failed.length > 50) {
        this.logger.warn(
          `High number of failed Soroban transaction jobs: ${failed.length}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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

    const job = await this.sorobanQueue.add(
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

    this.logger.log(
      `Scheduled Soroban transaction ${transactionId} for execution`,
      {
        jobId: job.id,
        delay: options.delay,
        priority: options.priority,
      },
    );

    return job;
  }

  /**
   * Get queue statistics for monitoring
   */
  async getQueueStats() {
    return {
      waiting: (await this.sorobanQueue.getWaiting()).length,
      active: (await this.sorobanQueue.getActive()).length,
      completed: (await this.sorobanQueue.getCompleted()).length,
      failed: (await this.sorobanQueue.getFailed()).length,
      delayed: (await this.sorobanQueue.getDelayed()).length,
    };
  }
}
