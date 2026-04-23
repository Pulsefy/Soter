import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { DeadLetterJobData } from './dead-letter.processor';

export interface DlqJobSummary {
  dlqJobId: string;
  originalQueue: string;
  originalJobId: string;
  originalJobName: string;
  failureReason: string;
  attemptsMade: number;
  deadAt: string;
}

export interface DlqStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Service for interacting with the Dead Letter Queue.
 *
 * Provides:
 *  - Moving a failed job into the DLQ
 *  - Listing / inspecting dead-letter records
 *  - Requeueing a dead-letter job back to its original queue
 *  - Purging processed dead-letter records
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(
    @InjectQueue('dead-letter') private readonly dlq: Queue<DeadLetterJobData>,
  ) {}

  /**
   * Move a permanently-failed job into the DLQ.
   * Called by each processor's `@OnWorkerEvent('failed')` handler when
   * `job.attemptsMade >= job.opts.attempts`.
   */
  async moveToDeadLetter(
    originalQueue: string,
    job: Job,
    error: Error,
  ): Promise<void> {
    const payload: DeadLetterJobData = {
      originalQueue,
      originalJobId: job.id ?? 'unknown',
      originalJobName: job.name,
      originalData: job.data,
      failureReason: error.message,
      failureStack: error.stack,
      attemptsMade: job.attemptsMade,
      deadAt: Date.now(),
    };

    await this.dlq.add('dead-letter-record', payload, {
      removeOnComplete: 500, // keep last 500 processed DLQ records
      removeOnFail: false,   // never auto-remove failed DLQ records
    });

    this.logger.warn(
      `Moved job ${job.id} from "${originalQueue}" to DLQ after ` +
        `${job.attemptsMade} attempt(s): ${error.message}`,
    );
  }

  /** Return current DLQ queue counts. */
  async getStats(): Promise<DlqStats> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.dlq.getWaitingCount(),
      this.dlq.getActiveCount(),
      this.dlq.getCompletedCount(),
      this.dlq.getFailedCount(),
      this.dlq.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }

  /**
   * List the most recent N waiting dead-letter records.
   * Useful for the monitoring dashboard.
   */
  async listWaiting(limit = 50): Promise<DlqJobSummary[]> {
    const jobs = await this.dlq.getWaiting(0, limit - 1);
    return jobs.map(j => this.toSummary(j));
  }

  /**
   * List the most recent N failed dead-letter records
   * (DLQ processor itself failed – rare but possible).
   */
  async listFailed(limit = 50): Promise<DlqJobSummary[]> {
    const jobs = await this.dlq.getFailed(0, limit - 1);
    return jobs.map(j => this.toSummary(j));
  }

  /**
   * Requeue a dead-letter record back to its original queue.
   * The caller is responsible for injecting the target queue.
   */
  async requeueJob(
    dlqJobId: string,
    targetQueue: Queue,
  ): Promise<{ requeuedJobId: string }> {
    const dlqJob = await this.dlq.getJob(dlqJobId);
    if (!dlqJob) {
      throw new Error(`DLQ job ${dlqJobId} not found`);
    }

    const requeued = await targetQueue.add(
      dlqJob.data.originalJobName,
      dlqJob.data.originalData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );

    // Remove the DLQ record now that it has been requeued
    await dlqJob.remove();

    this.logger.log(
      `Requeued DLQ job ${dlqJobId} → new job ${requeued.id} on ` +
        `"${dlqJob.data.originalQueue}"`,
    );

    return { requeuedJobId: requeued.id ?? 'unknown' };
  }

  private toSummary(job: Job<DeadLetterJobData>): DlqJobSummary {
    return {
      dlqJobId: job.id ?? 'unknown',
      originalQueue: job.data.originalQueue,
      originalJobId: job.data.originalJobId,
      originalJobName: job.data.originalJobName,
      failureReason: job.data.failureReason,
      attemptsMade: job.data.attemptsMade,
      deadAt: new Date(job.data.deadAt).toISOString(),
    };
  }
}
