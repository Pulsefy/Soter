/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  OnchainJobData,
  OnchainJobResult,
  OnchainOperationType,
} from './interfaces/onchain-job.interface';
import { ONCHAIN_ADAPTER_TOKEN, OnchainAdapter } from './onchain.adapter';

@Processor('onchain', {
  concurrency: 1, // Usually sequential for blockchain transactions
})
export class OnchainProcessor extends WorkerHost {
  private readonly logger = new Logger(OnchainProcessor.name);
  private readonly deadLetterQueue: Queue;

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly configService: ConfigService,
  ) {
    super();
    this.deadLetterQueue = new Queue('onchain-dead-letter', {
      connection: {
        host: this.configService.get<string>('REDIS_HOST') || 'localhost',
        port: parseInt(this.configService.get<string>('REDIS_PORT') || '6379', 10),
      },
    });
  }

  async process(
    job: Job<OnchainJobData, OnchainJobResult, string>,
  ): Promise<OnchainJobResult> {
    this.logger.log(
      `Processing onchain ${job.data.type} (attempt ${job.attemptsMade + 1})`,
    );

    try {
      let result: any;
      switch (job.data.type) {
        case OnchainOperationType.INIT_ESCROW:
          result = await this.onchainAdapter.initEscrow(job.data.params);
          break;
        case OnchainOperationType.CREATE_CLAIM:
          result = await this.onchainAdapter.createClaim(job.data.params);
          break;
        case OnchainOperationType.DISBURSE:
          result = await this.onchainAdapter.disburse(job.data.params);
          break;
        default:
          throw new Error(
            `Unknown onchain operation type: ${String(job.data.type)}`,
          );
      }

      if (result && 'status' in result && result.status === 'failed') {
        throw new Error(`Onchain operation failed: ${String(job.data.type)}`);
      }

      return {
        success: true,
        transactionHash: result?.transactionHash,
        metadata: result?.metadata,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown onchain error';
      const stack = error instanceof Error ? error.stack : undefined;

      if (this.isTransientOnchainError(error)) {
        this.logger.warn(
          `Transient onchain error for job ${job.id}: ${message}`,
        );
      } else {
        this.logger.error(
          `Onchain job ${job.id} failed: ${message}`,
          stack,
        );
      }

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<OnchainJobData, OnchainJobResult>) {
    this.logger.log(`Onchain job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<OnchainJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(`Onchain job ${job.id} failed: ${error.message}`);
      if (this.isFinalFailure(job)) {
        await this.moveToDeadLetterQueue(job, error);
      }
    } else {
      this.logger.error(`Onchain job failed: ${error.message}`);
    }
  }

  private isTransientOnchainError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const normalized = error.message.toLowerCase();
    return [
      'timeout',
      'timed out',
      'network',
      'connection reset',
      'econnrefused',
      'econnreset',
      'ledger congestion',
      'rate limit',
      'rate-limited',
      'service unavailable',
      'unavailable',
      '503',
      '504',
    ].some(token => normalized.includes(token));
  }

  private isFinalFailure(job: Job<OnchainJobData>): boolean {
    const totalAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= totalAttempts;
  }

  private async moveToDeadLetterQueue(job: Job<OnchainJobData>, error: Error) {
    await this.deadLetterQueue.add(
      `dead-letter-${job.id}`,
      {
        originalJobId: job.id,
        originalName: job.name,
        data: job.data,
        failedAt: new Date().toISOString(),
        failedReason: error.message,
        attemptsMade: job.attemptsMade,
        stack: error.stack,
      },
      {
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.logger.warn(
      `Moved job ${job.id} to onchain dead letter queue after ${job.attemptsMade} attempts`,
    );
  }
}
