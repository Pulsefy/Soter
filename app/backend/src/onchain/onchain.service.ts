import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  OnchainJobData,
  OnchainOperationType,
} from './interfaces/onchain-job.interface';

@Injectable()
export class OnchainService {
  private readonly logger = new Logger(OnchainService.name);

  constructor(@InjectQueue('onchain') private readonly onchainQueue: Queue) {}

  async enqueueInitEscrow(params: any) {
    return this.enqueue(OnchainOperationType.INIT_ESCROW, params);
  }

  async enqueueCreateClaim(params: any) {
    return this.enqueue(OnchainOperationType.CREATE_CLAIM, params);
  }

  async enqueueDisburse(params: any) {
    return this.enqueue(OnchainOperationType.DISBURSE, params);
  }

  private async enqueue(type: OnchainOperationType, params: any) {
    const data: OnchainJobData = {
      type,
      params: params as unknown,
      timestamp: Date.now(),
    };

    const job = await this.onchainQueue.add(type, data, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
      removeOnComplete: {
        count: 100,
        age: 7 * 24 * 60 * 60,
      },
      removeOnFail: {
        count: 50,
        age: 7 * 24 * 60 * 60,
      },
    });

    this.logger.log(`Enqueued onchain job: ${job.id} for ${type}`);
    return job;
  }
}
