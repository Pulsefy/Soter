/**
 * Job Status Streaming REST API Controller
 * Provides REST endpoints for querying job status and subscription history
 */

import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { JobStatusBroadcaster } from '../services/job-status-broadcaster.service';
import {
  JobStatusEvent,
  JobStatusWithResultDto,
} from '../dtos/job-status-event.dto';

@ApiTags('Jobs - Status Streaming')
@Controller('jobs')
export class JobStatusStreamingController {
  constructor(private readonly jobStatusBroadcaster: JobStatusBroadcaster) {}

  /**
   * Get current job status
   * Returns the most recent status update for a job
   */
  @Get(':jobId/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get current job status',
    description: 'Retrieves the most recent status update for a specific job.',
  })
  @ApiOkResponse({
    description: 'Job status retrieved successfully',
    schema: {
      example: {
        id: 'job_123',
        type: 'inference',
        status: 'processing',
        progress: 45,
        createdAt: '2026-07-24T10:00:00.000Z',
        updatedAt: '2026-07-24T10:05:00.000Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Job not found' })
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<JobStatusWithResultDto | null> {
    const history = await this.jobStatusBroadcaster.getJobHistory(jobId, 1);
    return history.length > 0 ? history[0].job : null;
  }

  /**
   * Get job status history
   * Returns recent status updates for a job (useful for clients implementing polling)
   */
  @Get(':jobId/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get job status history',
    description:
      'Retrieves recent status updates for a job. Useful for polling clients to catch missed updates.',
  })
  @ApiOkResponse({
    description: 'Job history retrieved successfully',
    schema: {
      example: {
        jobId: 'job_123',
        events: [
          {
            eventId: 'evt_001',
            job: {
              id: 'job_123',
              type: 'inference',
              status: 'processing',
              progress: 45,
              createdAt: '2026-07-24T10:00:00.000Z',
              updatedAt: '2026-07-24T10:05:00.000Z',
            },
            emittedAt: '2026-07-24T10:05:00.000Z',
            isTerminal: false,
          },
        ],
      },
    },
  })
  async getJobHistory(
    @Param('jobId') jobId: string,
    @Query('limit') limit?: string,
  ): Promise<{ jobId: string; events: JobStatusEvent[] }> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    const events = await this.jobStatusBroadcaster.getJobHistory(
      jobId,
      parsedLimit,
    );

    return {
      jobId,
      events,
    };
  }

  /**
   * Get job subscription metrics
   * Returns information about active subscriptions for a job
   */
  @Get(':jobId/subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get job subscription metrics',
    description:
      'Retrieves information about active subscriptions and streaming connections for a job.',
  })
  @ApiOkResponse({
    description: 'Subscription metrics retrieved successfully',
    schema: {
      example: {
        jobId: 'job_123',
        activeSubscriptions: 3,
        totalHistoryEvents: 15,
      },
    },
  })
  async getSubscriptionMetrics(@Param('jobId') jobId: string): Promise<{
    jobId: string;
    activeSubscriptions: number;
    totalHistoryEvents: number;
  }> {
    const count = await this.jobStatusBroadcaster.getSubscriptionCount(jobId);
    const history = await this.jobStatusBroadcaster.getJobHistory(jobId, 1000);

    return {
      jobId,
      activeSubscriptions: count,
      totalHistoryEvents: history.length,
    };
  }

  /**
   * Get global streaming metrics
   * Returns aggregate metrics about job status streaming
   */
  @Get('_/metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get global streaming metrics',
    description:
      'Retrieves aggregate metrics about all active job status streams.',
  })
  @ApiOkResponse({
    description: 'Metrics retrieved successfully',
    schema: {
      example: {
        historyRecords: 250,
        totalHistoryEvents: 5000,
        subscriptionHolders: 45,
        totalActiveSubscriptions: 120,
      },
    },
  })
  async getMetrics(): Promise<Record<string, unknown>> {
    return await this.jobStatusBroadcaster.getMetrics();
  }
}
