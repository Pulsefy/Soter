import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { RETENTION_PURGE_QUEUE } from '../retention-policy/retention-purge.processor';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @InjectQueue('dead-letter') private readonly dlqQueue: Queue,
    @InjectQueue('verification') private readonly verificationQueue: Queue,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
    @InjectQueue(RETENTION_PURGE_QUEUE)
    private readonly retentionPurgeQueue: Queue,
    private readonly auditService: AuditService,
  ) {}

  private getOriginalQueue(name: string): Queue | undefined {
    switch (name) {
      case 'verification':
        return this.verificationQueue;
      case 'notifications':
        return this.notificationsQueue;
      case 'onchain':
        return this.onchainQueue;
      case RETENTION_PURGE_QUEUE:
        return this.retentionPurgeQueue;
      default:
        return undefined;
    }
  }

  /**
   * Move a failed job to the dead-letter queue if it has exhausted all attempts.
   */
  async moveToDlq(
    originalQueue: string,
    job: Job,
    error: Error,
  ): Promise<void> {
    const maxAttempts = job.opts.attempts || 1;
    if (job.attemptsMade >= maxAttempts) {
      try {
        this.logger.warn(
          `Moving job ${job.id} from queue ${originalQueue} to dead-letter queue after ${job.attemptsMade} attempts.`,
        );
        await this.dlqQueue.add(`dlq-${originalQueue}`, {
          originalId: job.id,
          originalQueue,
          data: job.data,
          failedReason: error.message,
          failedAt: new Date().toISOString(),
          attemptsMade: job.attemptsMade,
        });
      } catch (dlqError) {
        this.logger.error(
          `Failed to move job ${job.id} to dead-letter queue: ${dlqError instanceof Error ? dlqError.message : String(dlqError)}`,
        );
      }
    }
  }

  async getDlqJobs(offset: number = 0, limit: number = 50) {
    const jobs = await this.dlqQueue.getJobs(
      ['waiting', 'delayed'],
      offset,
      offset + limit - 1,
    );
    return jobs.map(j => ({
      id: j.id,
      name: j.name,
      data: j.data,
      failedReason: j.failedReason,
      timestamp: j.timestamp,
    }));
  }

  async getJobHistory(id: string) {
    const job = await this.dlqQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found in DLQ`);
    }
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      attemptsMade: job.data?.attemptsMade,
      failedAt: job.data?.failedAt,
      failedReason: job.data?.failedReason,
    };
  }

  async replayJob(id: string, actorId: string) {
    const job = await this.dlqQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job ${id} not found in DLQ`);
    }
    const originalQueueName = job.data?.originalQueue;
    if (!originalQueueName) {
      throw new BadRequestException(`Job ${id} is missing originalQueue data`);
    }

    const targetQueue = this.getOriginalQueue(originalQueueName);
    if (!targetQueue) {
      throw new BadRequestException(
        `Target queue ${originalQueueName} is not recognized`,
      );
    }

    const replayedJob = await targetQueue.add(
      job.data?.originalId || 'replayed-job',
      job.data.data,
    );

    await job.remove();

    await this.auditService.record({
      actorId,
      entity: 'Job',
      entityId: String(job.id),
      action: 'replay_dlq_job',
      metadata: {
        originalQueue: originalQueueName,
        originalId: job.data.originalId,
        newJobId: replayedJob.id,
      },
    });

    return { success: true, replayedJobId: replayedJob.id };
  }
}
