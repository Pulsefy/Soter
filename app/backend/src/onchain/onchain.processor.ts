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
          // Map legacy/job params to createAidPackage
          result = await this.onchainAdapter.createAidPackage({
            operatorAddress: job.data.params.operatorAddress || 'system',
            packageId: job.data.params.claimId || job.data.params.packageId,
            recipientAddress: job.data.params.recipientAddress,
            amount: job.data.params.amount,
            tokenAddress: job.data.params.tokenAddress,
            expiresAt: job.data.params.expiresAt || 0,
            delegateAddress: job.data.params.delegateAddress,
          });
          break;
        case OnchainOperationType.DISBURSE:
          // Use the newer disburseAidPackage method
          result = await this.onchainAdapter.disburseAidPackage({
            packageId: job.data.params.packageId || job.data.params.claimId,
            operatorAddress: job.data.params.operatorAddress || 'system',
          });
          break;
        case OnchainOperationType.UPDATE_DELEGATE:
          result = await this.onchainAdapter.updateDelegate(job.data.params);
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
