import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiSecurity,
} from '@nestjs/swagger';
import { DeadLetterService } from './dead-letter.service';

// ---------------------------------------------------------------------------
// Shared response shapes
// ---------------------------------------------------------------------------

interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  /** Ratio of failed / (completed + failed), rounded to 4 dp */
  failureRate: number;
  /** true when failed > 0 or active jobs are stalled */
  degraded: boolean;
}

interface HealthSummary {
  status: 'healthy' | 'degraded' | 'critical';
  queues: Record<string, QueueStatus>;
  deadLetter: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Jobs')
@ApiSecurity('x-api-key')
@Controller('jobs')
export class JobsController {
  constructor(
    @InjectQueue('verification') private readonly verificationQueue: Queue,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
    private readonly deadLetterService: DeadLetterService,
  ) {}

  // -------------------------------------------------------------------------
  // GET /jobs/status  – raw queue counts (backwards-compatible)
  // -------------------------------------------------------------------------

  @Get('status')
  @ApiOperation({
    summary: 'Raw queue counts for all background job queues',
    description:
      'Returns waiting / active / completed / failed / delayed counts for ' +
      'the verification, notifications, and onchain queues.',
  })
  @ApiOkResponse({
    description: 'Queue counts retrieved successfully.',
    schema: {
      example: {
        verification: {
          name: 'verification',
          waiting: 0,
          active: 0,
          completed: 10,
          failed: 0,
          delayed: 0,
          failureRate: 0,
          degraded: false,
        },
        notifications: {
          name: 'notifications',
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
          failureRate: 0,
          degraded: false,
        },
        onchain: {
          name: 'onchain',
          waiting: 0,
          active: 0,
          completed: 2,
          failed: 0,
          delayed: 0,
          failureRate: 0,
          degraded: false,
        },
      },
    },
  })
  async getStatus(): Promise<Record<string, QueueStatus>> {
    const [verification, notifications, onchain] = await Promise.all([
      this.buildQueueStatus(this.verificationQueue),
      this.buildQueueStatus(this.notificationsQueue),
      this.buildQueueStatus(this.onchainQueue),
    ]);

    return { verification, notifications, onchain };
  }

  // -------------------------------------------------------------------------
  // GET /jobs/health  – aggregated health summary including DLQ
  // -------------------------------------------------------------------------

  @Get('health')
  @ApiOperation({
    summary: 'Aggregated queue health including Dead Letter Queue',
    description:
      'Returns an overall health status (healthy / degraded / critical) ' +
      'plus per-queue metrics and DLQ stats. Use this endpoint for ' +
      'dashboards and alerting.',
  })
  @ApiOkResponse({
    description: 'Health summary retrieved successfully.',
    schema: {
      example: {
        status: 'healthy',
        queues: {},
        deadLetter: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
        checkedAt: '2026-04-23T12:00:00.000Z',
      },
    },
  })
  async getHealth(): Promise<HealthSummary> {
    const [verification, notifications, onchain, dlqStats] = await Promise.all([
      this.buildQueueStatus(this.verificationQueue),
      this.buildQueueStatus(this.notificationsQueue),
      this.buildQueueStatus(this.onchainQueue),
      this.deadLetterService.getStats(),
    ]);

    const queues = { verification, notifications, onchain };

    // Determine overall health
    const anyDegraded = Object.values(queues).some(q => q.degraded);
    const dlqHasWaiting = dlqStats.waiting > 0;
    const highFailureRate = Object.values(queues).some(
      q => q.failureRate > 0.1,
    );

    let status: HealthSummary['status'] = 'healthy';
    if (highFailureRate || dlqStats.failed > 0) {
      status = 'critical';
    } else if (anyDegraded || dlqHasWaiting) {
      status = 'degraded';
    }

    return {
      status,
      queues,
      deadLetter: dlqStats,
      checkedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // GET /jobs/dead-letter  – list DLQ records
  // -------------------------------------------------------------------------

  @Get('dead-letter')
  @ApiOperation({
    summary: 'List jobs in the Dead Letter Queue',
    description:
      'Returns the most recent permanently-failed jobs that have been ' +
      'moved to the DLQ after exhausting all retries.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of records to return (default 50, max 200)',
  })
  @ApiOkResponse({
    description: 'DLQ records retrieved successfully.',
  })
  async listDeadLetterJobs(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(limit, 200);
    const [waiting, failed, stats] = await Promise.all([
      this.deadLetterService.listWaiting(safeLimit),
      this.deadLetterService.listFailed(safeLimit),
      this.deadLetterService.getStats(),
    ]);

    return {
      stats,
      waiting,
      failed,
      retrievedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // POST /jobs/dead-letter/:id/requeue  – requeue a DLQ record
  // -------------------------------------------------------------------------

  @Post('dead-letter/:id/requeue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Requeue a dead-letter job back to its original queue',
    description:
      'Moves a DLQ record back to the appropriate domain queue for ' +
      'reprocessing. The DLQ record is removed on success.',
  })
  @ApiParam({ name: 'id', description: 'DLQ job ID to requeue' })
  @ApiOkResponse({
    description: 'Job requeued successfully.',
    schema: {
      example: { requeuedJobId: '42', originalQueue: 'onchain' },
    },
  })
  async requeueDeadLetterJob(@Param('id') id: string) {
    // Peek at the DLQ record to determine the target queue
    const records = await this.deadLetterService.listWaiting(200);
    const record = records.find(r => r.dlqJobId === id);

    if (!record) {
      throw new NotFoundException(`DLQ job ${id} not found in waiting state`);
    }

    const targetQueue = this.resolveQueue(record.originalQueue);
    const result = await this.deadLetterService.requeueJob(id, targetQueue);

    return {
      ...result,
      originalQueue: record.originalQueue,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async buildQueueStatus(queue: Queue): Promise<QueueStatus> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    const total = completed + failed;
    const failureRate = total > 0 ? Math.round((failed / total) * 10000) / 10000 : 0;
    const degraded = failed > 0;

    return {
      name: queue.name,
      waiting,
      active,
      completed,
      failed,
      delayed,
      failureRate,
      degraded,
    };
  }

  private resolveQueue(queueName: string): Queue {
    switch (queueName) {
      case 'verification':
        return this.verificationQueue;
      case 'notifications':
        return this.notificationsQueue;
      case 'onchain':
        return this.onchainQueue;
      default:
        throw new NotFoundException(
          `Cannot requeue: unknown source queue "${queueName}"`,
        );
    }
  }
}
