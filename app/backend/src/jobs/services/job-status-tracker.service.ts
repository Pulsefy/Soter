/**
 * Job Status Tracker Service
 * Monitors job transitions and emits status update events
 * Integrates with Bull job queue and AI service webhooks
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';

import { JobStatusBroadcaster } from './job-status-broadcaster.service';
import {
  JobStatusEvent,
  JobStatusWithResultDto,
  JobStatus,
  JobType,
  TERMINAL_JOB_STATES,
} from '../dtos/job-status-event.dto';

/**
 * Payload for internal job events
 */
export interface JobStatusPayload {
  jobId: string;
  jobType: JobType;
  status: JobStatus;
  progress?: number;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  attemptsMade?: number;
  maxRetries?: number;
  metadata?: {
    userId?: string;
    correlationId?: string;
    campaignId?: string;
    claimId?: string;
    packageId?: string;
    [key: string]: unknown;
  };
}

@Injectable()
export class JobStatusTracker {
  private readonly logger = new Logger(JobStatusTracker.name);

  /**
   * Map to track job creation timestamps
   * Used to calculate proper createdAt times
   */
  private readonly jobCreationTimes = new Map<string, Date>();

  constructor(private readonly jobStatusBroadcaster: JobStatusBroadcaster) {}

  /**
   * Emit a job status update event
   * @param payload - Job status information
   */
  async emitJobStatus(payload: JobStatusPayload): Promise<void> {
    try {
      const now = new Date();
      const isTerminal = TERMINAL_JOB_STATES.includes(payload.status);

      // Get or initialize creation time
      let createdAt = this.jobCreationTimes.get(payload.jobId);
      if (!createdAt) {
        createdAt = now;
        this.jobCreationTimes.set(payload.jobId, createdAt);

        // Clean up old entries (keep for 1 hour)
        if (this.jobCreationTimes.size > 10000) {
          const cutoff = new Date(now.getTime() - 3600000);
          for (const [id, time] of this.jobCreationTimes) {
            if (time < cutoff) {
              this.jobCreationTimes.delete(id);
            }
          }
        }
      }

      // Clean up creation time for terminal states
      if (isTerminal) {
        this.jobCreationTimes.delete(payload.jobId);
      }

      // Build job status DTO
      const jobStatus: JobStatusWithResultDto = {
        id: payload.jobId,
        type: payload.jobType,
        status: payload.status,
        progress: payload.progress,
        result: payload.result,
        error: payload.error,
        attemptsMade: payload.attemptsMade,
        maxRetries: payload.maxRetries,
        createdAt,
        updatedAt: now,
      };

      // Build and emit event
      const event: JobStatusEvent = {
        eventId: uuidv4(),
        job: jobStatus,
        userId: payload.metadata?.userId,
        correlationId: payload.metadata?.correlationId,
        emittedAt: now,
        isTerminal,
        metadata: {
          campaignId: payload.metadata?.campaignId as string,
          claimId: payload.metadata?.claimId as string,
          packageId: payload.metadata?.packageId as string,
        },
      };

      // Broadcast to subscribers
      await this.jobStatusBroadcaster.broadcastJobStatus(event);

      this.logger.debug(
        `Emitted job status: ${payload.jobId} (${payload.status}) [${event.correlationId}]`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit job status: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Handle job created event from Bull
   * Fires when a job is added to the queue
   */
  @OnEvent('bull:job-created')
  async onJobCreated(payload: {
    jobId: string;
    jobType: JobType;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.PENDING,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle job started event from Bull
   * Fires when a worker starts processing a job
   */
  @OnEvent('bull:job-started')
  async onJobStarted(payload: {
    jobId: string;
    jobType: JobType;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.PROCESSING,
      progress: 0,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle job progress event
   * Fires when processing updates progress
   */
  @OnEvent('bull:job-progress')
  async onJobProgress(payload: {
    jobId: string;
    jobType: JobType;
    progress: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.PROCESSING,
      progress: payload.progress,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle job completed event from Bull
   * Fires when a job completes successfully
   */
  @OnEvent('bull:job-completed')
  async onJobCompleted(payload: {
    jobId: string;
    jobType: JobType;
    result: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.COMPLETED,
      progress: 100,
      result: payload.result,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle job failed event from Bull
   * Fires when a job fails
   */
  @OnEvent('bull:job-failed')
  async onJobFailed(payload: {
    jobId: string;
    jobType: JobType;
    error: { code: string; message: string };
    attemptsMade?: number;
    maxRetries?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.FAILED,
      error: payload.error,
      attemptsMade: payload.attemptsMade,
      maxRetries: payload.maxRetries,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle job retrying event
   * Fires when a failed job is being retried
   */
  @OnEvent('bull:job-retrying')
  async onJobRetrying(payload: {
    jobId: string;
    jobType: JobType;
    attemptsMade?: number;
    maxRetries?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.RETRYING,
      attemptsMade: payload.attemptsMade,
      maxRetries: payload.maxRetries,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle job cancelled event
   * Fires when a job is manually cancelled
   */
  @OnEvent('bull:job-cancelled')
  async onJobCancelled(payload: {
    jobId: string;
    jobType: JobType;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.CANCELLED,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle AI service webhook for job completion
   * Called when AI service sends completion callback
   */
  async onAiServiceJobCompleted(payload: {
    jobId: string;
    jobType: JobType;
    result: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.COMPLETED,
      progress: 100,
      result: payload.result,
      metadata: payload.metadata,
    });
  }

  /**
   * Handle AI service webhook for job failure
   */
  async onAiServiceJobFailed(payload: {
    jobId: string;
    jobType: JobType;
    error: { code: string; message: string };
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitJobStatus({
      jobId: payload.jobId,
      jobType: payload.jobType,
      status: JobStatus.FAILED,
      error: payload.error,
      metadata: payload.metadata,
    });
  }

  /**
   * Get broadcaster instance for direct access
   */
  getBroadcaster(): JobStatusBroadcaster {
    return this.jobStatusBroadcaster;
  }
}
