import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { RETENTION_PURGE_QUEUE } from '../retention-policy/retention-purge.processor';

@ApiTags('Jobs')
@Controller('jobs')
export class JobsController {
  constructor(
    @InjectQueue('verification') private verificationQueue: Queue,
    @InjectQueue('notifications') private notificationsQueue: Queue,
    @InjectQueue('onchain') private onchainQueue: Queue,
    @InjectQueue(RETENTION_PURGE_QUEUE) private retentionPurgeQueue: Queue,
    @InjectQueue('dead-letter') private deadLetterQueue: Queue,
  ) {}

  @ApiOperation({
    summary: 'Get status of all background job queues',
    description:
      'Retrieves the count of waiting, active, completed, failed, and delayed jobs for all system queues.',
  })
  @ApiOkResponse({
    description: 'Queue statuses retrieved successfully.',
    schema: {
      example: {
        verification: {
          name: 'verification',
          waiting: 0,
          active: 0,
          completed: 10,
          failed: 0,
          delayed: 0,
        },
        notifications: {
          name: 'notifications',
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
        },
        onchain: {
          name: 'onchain',
          waiting: 0,
          active: 0,
          completed: 2,
          failed: 0,
          delayed: 0,
        },
      },
    },
  })
  @Get('status')
  async getStatus() {
    return {
      verification: await this.getQueueStatus(this.verificationQueue),
      notifications: await this.getQueueStatus(this.notificationsQueue),
      onchain: await this.getQueueStatus(this.onchainQueue),
      'retention-purge': await this.getQueueStatus(this.retentionPurgeQueue),
      'dead-letter': await this.getQueueStatus(this.deadLetterQueue),
    };
  }

  @ApiOperation({
    summary: 'Get overall health of background job queues',
    description: 'Checks if any core queues are degraded (too many waiting or failed jobs).',
  })
  @Get('health')
  async getHealth() {
    const statuses = [
      await this.getQueueStatus(this.verificationQueue),
      await this.getQueueStatus(this.notificationsQueue),
      await this.getQueueStatus(this.onchainQueue),
    ];

    const isDegraded = statuses.some(s => s.waiting > 100 || s.failed > 50);

    const result = {
      status: isDegraded ? 'degraded' : 'ok',
      details: statuses.map(s => ({
        name: s.name,
        waiting: s.waiting,
        failed: s.failed,
      })),
    };

    if (isDegraded) {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
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
