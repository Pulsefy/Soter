import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { LoggerService } from '../logger/logger.service';

export interface SorobanTransactionJobData {
  transactionId: string;
  operation: 'execute' | 'retry' | 'cleanup';
  correlationId?: string;
}

const LOG_CONTEXT = 'SorobanTransactionScheduler';

@Injectable()
export class SorobanTransactionScheduler {
  private isProcessingRetries = false;
  private isProcessingCleanup = false;

  constructor(
    @InjectQueue('soroban-transactions')
    private readonly sorobanQueue: Queue<SorobanTransactionJobData>,
    private readonly sorobanTransactionService: SorobanTransactionLifecycleService,
    private readonly metricsService: MetricsService,
    private readonly loggerService: LoggerService,
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
      this.loggerService.debug(
        'Retry processing already in progress, skipping',
        LOG_CONTEXT,
      );
      return;
    }

    this.isProcessingRetries = true;
    const startTime = Date.now();

    try {
      const retryableTransactions =
        await this.sorobanTransactionService.getRetryableTransactions();

      if (retryableTransactions.length === 0) {
        this.loggerService.debug(
          'No retryable Soroban transactions found',
          LOG_CONTEXT,
        );
        return;
      }

      this.loggerService.log(
        `Found ${retryableTransactions.length} retryable Soroban transactions`,
        LOG_CONTEXT,
        {
          transactionIds: retryableTransactions.map(tx => tx.id),
          correlationIds: retryableTransactions
            .map(tx => tx.correlationId)
            .filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
        },
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

        const job = await this.sorobanQueue.add(
          `retry-${transaction.id}`,
          jobData,
          {
            delay,
            attempts: 3, // Job-level retries for the scheduler itself
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        );

        // The enqueue is logged with the correlation ID that will be re-bound
        // by the worker, so the scheduled retry is traceable before it runs.
        this.loggerService.debug(
          `Enqueued Soroban transaction retry for ${transaction.id}`,
          LOG_CONTEXT,
          {
            jobId: job.id,
            transactionId: transaction.id,
            operation: 'retry',
            correlationId: transaction.correlationId ?? undefined,
            delay,
          },
        );

        return job;
      });

      await Promise.all(jobPromises);

      const duration = (Date.now() - startTime) / 1000;

      this.loggerService.log(
        `Scheduled ${retryableTransactions.length} Soroban transaction retries in ${duration}s`,
        LOG_CONTEXT,
        {
          count: retryableTransactions.length,
          duration,
        },
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
      this.loggerService.error(
        `Failed to schedule retryable Soroban transactions: ${errorMessage}`,
        undefined,
        LOG_CONTEXT,
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
      this.loggerService.debug(
        'Cleanup processing already in progress, skipping',
        LOG_CONTEXT,
      );
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

      this.loggerService.debug(
        `Scheduled Soroban transaction cleanup in ${duration}s`,
        LOG_CONTEXT,
        {
          correlationId: jobData.correlationId,
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggerService.error(
        `Failed to schedule Soroban cleanup job: ${errorMessage}`,
        undefined,
        LOG_CONTEXT,
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
   * Detect stuck Soroban transactions - every minute
   */
  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'detect-stuck-soroban-transactions',
    timeZone: 'UTC',
  })
  async detectStuckTransactions() {
    try {
      await this.sorobanTransactionService.detectStuckTransactions();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggerService.error(
        `Failed to detect stuck Soroban transactions: ${errorMessage}`,
        undefined,
        LOG_CONTEXT,
        {
          error: errorMessage,
        },
      );
      this.metricsService.incrementCounter('soroban_stuck_detection_failed', {
        error: errorMessage.substring(0, 100),
      });
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
        this.loggerService.warn(
          `High number of waiting Soroban transaction jobs: ${waiting.length}`,
          LOG_CONTEXT,
          { waiting: waiting.length },
        );
      }

      if (failed.length > 50) {
        this.loggerService.warn(
          `High number of failed Soroban transaction jobs: ${failed.length}`,
          LOG_CONTEXT,
          { failed: failed.length },
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.loggerService.error(
        `Soroban queue health check failed: ${errorMessage}`,
        undefined,
        LOG_CONTEXT,
        { error: errorMessage },
      );

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

    this.loggerService.log(
      `Scheduled Soroban transaction ${transactionId} for execution`,
      LOG_CONTEXT,
      {
        jobId: job.id,
        transactionId,
        correlationId: options.correlationId,
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
