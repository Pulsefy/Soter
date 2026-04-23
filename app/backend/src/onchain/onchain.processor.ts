/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
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

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {
    super();
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
      this.logger.error(
        `Onchain job ${job.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<OnchainJobData, OnchainJobResult>) {
    this.logger.log(`Onchain job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<OnchainJobData> | undefined, error: Error) {
    if (job) {
      this.logger.error(`Onchain job ${job.id} failed: ${error.message}`);
    } else {
      this.logger.error(`Onchain job failed: ${error.message}`);
    }
  }
}
