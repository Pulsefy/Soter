import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  OnchainJobData,
  OnchainOperationType,
} from './interfaces/onchain-job.interface';

export interface CreateClaimJobParams {
  claimId: string;
  recipientAddress: string;
  amount: string;
  tokenAddress: string;
  expiresAt?: number;
  campaignId?: string;
}

export interface DisburseJobParams {
  claimId: string;
  packageId: string;
  recipientAddress?: string;
  amount?: string;
  tokenAddress: string;
}

export interface RevokeJobParams {
  claimId: string;
  packageId: string;
  tokenAddress: string;
}

export interface InitEscrowJobParams {
  adminAddress: string;
  supportedTokens?: string[]; // Optional list of supported token addresses
}

@Injectable()
export class OnchainService {
  private readonly logger = new Logger(OnchainService.name);

  constructor(@InjectQueue('onchain') private readonly onchainQueue: Queue) {}

  async enqueueInitEscrow(params: InitEscrowJobParams) {
    return this.enqueue(OnchainOperationType.INIT_ESCROW, params);
  }

  async enqueueCreateClaim(params: CreateClaimJobParams) {
    // Validate tokenAddress is present for multi-token support
    if (!params.tokenAddress) {
      throw new Error('tokenAddress is required for creating a claim');
    }
    return this.enqueue(OnchainOperationType.CREATE_CLAIM, params);
  }

  async enqueueDisburse(params: DisburseJobParams) {
    // Validate tokenAddress is present for multi-token support
    if (!params.tokenAddress) {
      throw new Error('tokenAddress is required for disbursement');
    }
    return this.enqueue(OnchainOperationType.DISBURSE, params);
  }

  async enqueueRevoke(params: RevokeJobParams) {
    return this.enqueue(OnchainOperationType.REVOKE, params);
  }

  private async enqueue(type: OnchainOperationType, params: unknown) {
    const data: OnchainJobData = {
      type,
      params,
      timestamp: Date.now(),
    };

    const job = await this.onchainQueue.add(type, data, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: true,
    });

    this.logger.log(`Enqueued onchain job: ${job.id} for ${type}`);
    return job;
  }
}
