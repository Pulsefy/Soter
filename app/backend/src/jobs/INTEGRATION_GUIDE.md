# Job Status Streaming Integration Guide

This guide explains how to integrate the job status streaming system with existing job handlers and services.

## Overview

The job status streaming system emits events through multiple integration points:

1. **Bull Job Queue Events** - Automatically emitted when jobs are queued/processed
2. **AI Service Webhooks** - Integrate job completion callbacks
3. **Manual Events** - Programmatically emit status updates

## Integration Points

### 1. Bull Job Queue Integration

The `JobStatusTracker` automatically listens to Bull job events. When you create or update a job in any Bull queue, status updates are automatically streamed.

#### Example: Creating a Job in Bull

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class InferenceService {
  constructor(
    @InjectQueue('inference') private inferenceQueue: Queue,
    private eventEmitter: EventEmitter2,
  ) {}

  async submitInferenceJob(payload: any, metadata: any) {
    // Create the job in Bull queue
    const job = await this.inferenceQueue.add(
      'process-inference',
      payload,
      {
        jobId: `job_${Date.now()}`,
        metadata,
      },
    );

    // Emit job created event (automatically broadcasts to WebSocket clients)
    this.eventEmitter.emit('bull:job-created', {
      jobId: job.id,
      jobType: 'inference',
      metadata: {
        userId: metadata.userId,
        campaignId: metadata.campaignId,
        correlationId: metadata.correlationId,
      },
    });

    return { jobId: job.id };
  }

  async processInferenceJob(job: Job) {
    try {
      // Update progress
      this.eventEmitter.emit('bull:job-progress', {
        jobId: job.id,
        jobType: 'inference',
        progress: 25,
      });

      // Do actual processing...
      const result = await this.runInference(job.data);

      // Update progress
      this.eventEmitter.emit('bull:job-progress', {
        jobId: job.id,
        jobType: 'inference',
        progress: 100,
      });

      // Emit completion
      this.eventEmitter.emit('bull:job-completed', {
        jobId: job.id,
        jobType: 'inference',
        result,
      });

      return result;
    } catch (error) {
      this.eventEmitter.emit('bull:job-failed', {
        jobId: job.id,
        jobType: 'inference',
        error: {
          code: error.code || 'ERR_PROCESSING',
          message: error.message,
        },
      });
      throw error;
    }
  }
}
```

#### Bull Queue Processor with Status Updates

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Processor('inference')
export class InferenceProcessor extends WorkerHost {
  constructor(private eventEmitter: EventEmitter2) {
    super();
  }

  async process(job: Job<InferencePayload>): Promise<any> {
    try {
      // Emit started event
      this.eventEmitter.emit('bull:job-started', {
        jobId: job.id,
        jobType: 'inference',
      });

      // Report progress
      for (let i = 0; i < 100; i += 20) {
        this.eventEmitter.emit('bull:job-progress', {
          jobId: job.id,
          jobType: 'inference',
          progress: i,
        });
        // ... do work
      }

      const result = await this.runInference(job.data);

      // Emit completion
      this.eventEmitter.emit('bull:job-completed', {
        jobId: job.id,
        jobType: 'inference',
        result,
      });

      return result;
    } catch (error) {
      if (job.attemptsMade < job.opts.attempts!) {
        this.eventEmitter.emit('bull:job-retrying', {
          jobId: job.id,
          jobType: 'inference',
          attemptsMade: job.attemptsMade,
          maxRetries: job.opts.attempts,
        });
      } else {
        this.eventEmitter.emit('bull:job-failed', {
          jobId: job.id,
          jobType: 'inference',
          error: {
            code: 'ERR_MAX_RETRIES',
            message: error.message,
          },
          attemptsMade: job.attemptsMade,
          maxRetries: job.opts.attempts,
        });
      }
      throw error;
    }
  }
}
```

### 2. AI Service Webhook Integration

When the AI service completes a job, integrate the status update through the webhook handler.

#### Example: AI Service Job Completion Webhook

```typescript
import { Injectable } from '@nestjs/common';
import { JobStatusTracker } from '../jobs/services/job-status-tracker.service';
import { JobType } from '../jobs/dtos/job-status-event.dto';

@Injectable()
export class WebhooksService {
  constructor(private jobStatusTracker: JobStatusTracker) {}

  async handleAiJobCompletion(payload: AiJobCompletionPayload) {
    const jobType = this.mapAiServiceType(payload.type);

    // Emit job completion
    await this.jobStatusTracker.onAiServiceJobCompleted({
      jobId: payload.jobId,
      jobType,
      result: payload.result,
      metadata: {
        userId: payload.userId,
        correlationId: payload.correlationId,
        campaignId: payload.campaignId,
        claimId: payload.claimId,
      },
    });

    // Continue with existing webhook processing...
  }

  async handleAiJobFailure(payload: AiJobFailurePayload) {
    const jobType = this.mapAiServiceType(payload.type);

    // Emit job failure
    await this.jobStatusTracker.onAiServiceJobFailed({
      jobId: payload.jobId,
      jobType,
      error: {
        code: payload.errorCode,
        message: payload.errorMessage,
      },
      metadata: {
        userId: payload.userId,
        correlationId: payload.correlationId,
      },
    });
  }

  private mapAiServiceType(aiType: string): JobType {
    const typeMap: Record<string, JobType> = {
      ocr: JobType.OCR,
      inference: JobType.INFERENCE,
      proof_of_life: JobType.PROOF_OF_LIFE,
      anonymize: JobType.ANONYMIZE,
      humanitarian_verification: JobType.HUMANITARIAN_VERIFICATION,
      fraud_detection: JobType.FRAUD_DETECTION,
    };
    return typeMap[aiType] || JobType.INFERENCE;
  }
}
```

### 3. Manual Status Updates

For jobs not using Bull or AI service webhooks, emit status updates directly.

#### Example: Custom Job Handler

```typescript
import { Injectable } from '@nestjs/common';
import { JobStatusTracker, JobStatusPayload } from '../jobs/services/job-status-tracker.service';
import { JobStatus, JobType } from '../jobs/dtos/job-status-event.dto';

@Injectable()
export class CustomJobService {
  constructor(private jobStatusTracker: JobStatusTracker) {}

  async processCustomJob(jobId: string, data: any) {
    try {
      // Emit pending status
      await this.jobStatusTracker.emitJobStatus({
        jobId,
        jobType: JobType.OCR,
        status: JobStatus.PENDING,
      });

      // Emit processing status
      await this.jobStatusTracker.emitJobStatus({
        jobId,
        jobType: JobType.OCR,
        status: JobStatus.PROCESSING,
        progress: 0,
      });

      // Do work with progress updates
      const result = await this.doWork(data, (progress) => {
        this.jobStatusTracker.emitJobStatus({
          jobId,
          jobType: JobType.OCR,
          status: JobStatus.PROCESSING,
          progress,
        });
      });

      // Emit completion
      await this.jobStatusTracker.emitJobStatus({
        jobId,
        jobType: JobType.OCR,
        status: JobStatus.COMPLETED,
        progress: 100,
        result,
      });
    } catch (error) {
      // Emit failure
      await this.jobStatusTracker.emitJobStatus({
        jobId,
        jobType: JobType.OCR,
        status: JobStatus.FAILED,
        error: {
          code: 'ERR_PROCESSING',
          message: error.message,
        },
      });
    }
  }
}
```

## WebSocket Client Integration

### Subscribe to Job Status in Frontend

```typescript
import { io, Socket } from 'socket.io-client';

class JobMonitor {
  private socket: Socket;
  private subscriptions = new Map<string, string>();

  connect(token: string) {
    this.socket = io(process.env.REACT_APP_WEBSOCKET_URL, {
      path: '/socket.io/jobs',
      auth: { token },
    });

    this.socket.on('jobStatus', (data) => {
      this.handleStatusUpdate(data);
    });

    this.socket.on('error', (error) => {
      this.handleError(error);
    });
  }

  subscribeToJob(jobId: string, options: any = {}) {
    this.socket.emit('subscribe', {
      jobId,
      options: {
        sendMissedUpdates: true,
        ...options,
      },
    });
  }

  private handleStatusUpdate(data: any) {
    const { event } = data;
    console.log(`Job ${event.job.id}: ${event.job.status}`);

    // Update UI based on status
    if (event.job.status === 'completed') {
      this.onJobCompleted(event.job);
    } else if (event.job.status === 'failed') {
      this.onJobFailed(event.job);
    } else if (event.job.progress) {
      this.onJobProgress(event.job.progress);
    }
  }
}
```

## Testing Job Status Streaming

### Unit Test Example

```typescript
import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JobStatusTracker } from './job-status-tracker.service';
import { JobStatusBroadcaster } from './job-status-broadcaster.service';

describe('Job Status Streaming', () => {
  let tracker: JobStatusTracker;
  let broadcaster: JobStatusBroadcaster;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [JobStatusTracker, JobStatusBroadcaster],
    }).compile();

    tracker = module.get(JobStatusTracker);
    broadcaster = module.get(JobStatusBroadcaster);
  });

  it('should stream job status updates', async () => {
    const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

    await tracker.emitJobStatus({
      jobId: 'job_123',
      jobType: 'inference',
      status: 'processing',
      progress: 50,
    });

    expect(broadcastSpy).toHaveBeenCalled();
    const event = broadcastSpy.mock.calls[0][0];
    expect(event.job.status).toBe('processing');
  });
});
```

### Integration Test Example

```typescript
describe('Job Status Streaming Integration', () => {
  let app: INestApplication;
  let jobsService: JobsService;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jobsService = app.get(JobsService);
  });

  it('should stream job updates from submission to completion', async (done) => {
    const client = io(`http://localhost:3000`, {
      path: '/socket.io/jobs',
      reconnection: false,
    });

    const statuses: string[] = [];

    client.on('jobStatus', (data) => {
      statuses.push(data.event.job.status);

      if (data.event.isTerminal) {
        expect(statuses).toContain('pending');
        expect(statuses).toContain('processing');
        expect(statuses).toContain('completed');
        client.disconnect();
        done();
      }
    });

    client.on('connected', () => {
      client.emit('subscribe', { jobId: 'test_job_123' });

      // Trigger job creation
      jobsService.submitJob({
        id: 'test_job_123',
        type: 'inference',
        data: {},
      });
    });
  });
});
```

## Monitoring and Operations

### Health Check

```typescript
@Get('health')
async healthCheck() {
  const metrics = await this.jobStatusBroadcaster.getMetrics();
  
  return {
    status: 'healthy',
    streaming: {
      activeSubscriptions: metrics.totalActiveSubscriptions,
      historyRecords: metrics.historyRecords,
    },
  };
}
```

### Cleanup Tasks

```typescript
import { Cron } from '@nestjs/schedule';

@Injectable()
export class JobStreamingMaintenance {
  constructor(private broadcaster: JobStatusBroadcaster) {}

  @Cron('0 0 * * *') // Daily at midnight
  async cleanupExpiredHistory() {
    const deleted = await this.broadcaster.cleanupHistory();
    console.log(`Cleaned up ${deleted} expired job history records`);
  }

  @Cron('0 * * * *') // Hourly
  async reportMetrics() {
    const metrics = await this.broadcaster.getMetrics();
    console.log('Job Status Streaming Metrics:', metrics);
  }
}
```

## Troubleshooting

### WebSocket Connection Issues

1. Check CORS configuration in `app.module.ts`
2. Verify Redis connection is active
3. Check authentication token validity

### Missed Updates Not Being Delivered

1. Verify `sendMissedUpdates: true` in subscription options
2. Check that history TTL hasn't expired
3. Verify Redis keys are not being purged

### High Memory Usage

1. Monitor `getMetrics()` endpoint
2. Adjust `MAX_HISTORY_SIZE` in broadcaster if needed
3. Run cleanup tasks more frequently

## Best Practices

1. **Always subscribe with `sendMissedUpdates: true`** for production clients
2. **Implement exponential backoff** for WebSocket reconnections
3. **Send ping/pong** every 30 seconds to maintain connection
4. **Handle terminal states** specially (especially errors and completions)
5. **Log correlation IDs** for debugging distributed systems
6. **Monitor subscription count** to detect leaks
