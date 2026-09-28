import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SorobanEventCorrelationService } from './soroban-event-correlation.service';
import { MetricsService } from '../observability/metrics/metrics.service';

export interface EventCorrelationJobData {
  startLedger?: number;
  endLedger?: number;
  contractId?: string;
  correlationSource: 'scheduled' | 'on_demand' | 'manual';
}

@Injectable()
export class SorobanEventCorrelationScheduler {
  private readonly logger = new Logger(SorobanEventCorrelationScheduler.name);
  private isProcessing = false;
  private lastProcessedLedger: number | null = null;

  constructor(
    @InjectQueue('onchain')
    private readonly onchainQueue: Queue<EventCorrelationJobData>,
    private readonly eventCorrelationService: SorobanEventCorrelationService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Scheduled job to correlate events - runs every 5 minutes
   * Processes new ledgers since last run
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'soroban-event-correlation',
    timeZone: 'UTC',
  })
  async scheduledCorrelation() {
    if (this.isProcessing) {
      this.logger.debug('Event correlation already in progress, skipping');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      // Determine ledger range to process
      const endLedger = this.getLatestLedger();
      const startLedger = this.lastProcessedLedger
        ? this.lastProcessedLedger + 1
        : endLedger - 100; // Default to last 100 ledgers on first run

      if (startLedger > endLedger) {
        this.logger.debug('No new ledgers to process');
        return;
      }

      this.logger.log(
        `Scheduled event correlation: ledgers ${startLedger}-${endLedger}`,
      );

      const jobData: EventCorrelationJobData = {
        startLedger,
        endLedger,
        correlationSource: 'scheduled',
      };

      await this.onchainQueue.add('event-correlation', jobData, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 50,
        removeOnFail: 20,
      });

      this.lastProcessedLedger = endLedger;

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Scheduled event correlation queued in ${duration}s`);

      this.metricsService.incrementCounter(
        'soroban_event_correlation_scheduled',
        {
          ledgersProcessed: (endLedger - startLedger + 1).toString(),
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to schedule event correlation: ${errorMessage}`,
        {
          error: errorMessage,
        },
      );

      this.metricsService.incrementCounter(
        'soroban_event_correlation_scheduling_failed',
        {
          error: errorMessage.substring(0, 100),
        },
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get the latest ledger from the network
   */
  private getLatestLedger(): number {
    // In a real implementation, this would query the RPC for the latest ledger
    // For now, we'll use a reasonable default
    return Math.floor(Date.now() / 5000) * 5000; // Approximate ledger number
  }

  /**
   * Manually trigger correlation for a specific ledger range
   */
  async triggerCorrelation(params: {
    startLedger: number;
    endLedger: number;
    contractId?: string;
    correlationSource?: 'on_demand' | 'manual';
  }) {
    const jobData: EventCorrelationJobData = {
      startLedger: params.startLedger,
      endLedger: params.endLedger,
      contractId: params.contractId,
      correlationSource: params.correlationSource || 'on_demand',
    };

    const job = await this.onchainQueue.add('event-correlation', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 50,
      removeOnFail: 20,
    });

    this.logger.log(`Manual event correlation triggered`, {
      jobId: job.id,
      startLedger: params.startLedger,
      endLedger: params.endLedger,
    });

    return job;
  }

  /**
   * Trigger on-demand correlation for a specific transaction
   */
  async correlateTransaction(txHash: string) {
    const jobData: EventCorrelationJobData = {
      correlationSource: 'on_demand',
    };

    // We pass the txHash in the job data for the processor to use
    (jobData as any).txHash = txHash;

    const job = await this.onchainQueue.add(
      'event-correlation-transaction',
      jobData,
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    this.logger.log(`On-demand transaction correlation triggered`, {
      jobId: job.id,
      txHash,
    });

    return job;
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      lastProcessedLedger: this.lastProcessedLedger,
    };
  }
}
