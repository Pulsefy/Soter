import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JobsMonitorService {
  private readonly deadLetterQueue: Queue;

  constructor(
    @InjectQueue('verification') private readonly verificationQueue: Queue,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.deadLetterQueue = new Queue('onchain-dead-letter', {
      connection: {
        host: this.configService.get<string>('REDIS_HOST') || 'localhost',
        port: parseInt(this.configService.get<string>('REDIS_PORT') || '6379', 10),
      },
    });
  }

  async getStatus() {
    return {
      verification: await this.getQueueStatus(this.verificationQueue),
      notifications: await this.getQueueStatus(this.notificationsQueue),
      onchain: await this.getQueueStatus(this.onchainQueue),
      onchainDeadLetter: await this.getQueueStatus(this.deadLetterQueue),
    };
  }

  private async getQueueStatus(queue: Queue) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      name: queue.name,
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  }
}
