/**
 * Job Status Tracker Tests
 * Tests job event emission and status tracking
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { REDIS_CLIENT } from '../../redis/redis.module';
import { JobStatusTracker } from '../services/job-status-tracker.service';
import { JobStatusBroadcaster } from '../services/job-status-broadcaster.service';
import { JobStatus, JobType } from '../dtos/job-status-event.dto';

describe('JobStatusTracker', () => {
  let service: JobStatusTracker;
  let broadcaster: JobStatusBroadcaster;
  let mockRedis: any;

  beforeEach(async () => {
    mockRedis = {
      publish: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn().mockReturnValue({
        lpush: jest.fn().mockReturnThis(),
        ltrim: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      lrange: jest.fn().mockResolvedValue([]),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        JobStatusTracker,
        JobStatusBroadcaster,
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<JobStatusTracker>(JobStatusTracker);
    broadcaster = module.get<JobStatusBroadcaster>(JobStatusBroadcaster);
  });

  describe('emitJobStatus', () => {
    it('should emit job status event', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.emitJobStatus({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        status: JobStatus.PROCESSING,
        progress: 50,
      });

      expect(broadcastSpy).toHaveBeenCalled();
      const event = broadcastSpy.mock.calls[0][0];
      expect(event.job.id).toBe('job_123');
      expect(event.job.status).toBe(JobStatus.PROCESSING);
      expect(event.job.progress).toBe(50);
    });

    it('should mark terminal events as terminal', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.emitJobStatus({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        status: JobStatus.COMPLETED,
        result: { data: 'test' },
      });

      const event = broadcastSpy.mock.calls[0][0];
      expect(event.isTerminal).toBe(true);
    });

    it('should not mark non-terminal events as terminal', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.emitJobStatus({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        status: JobStatus.PROCESSING,
      });

      const event = broadcastSpy.mock.calls[0][0];
      expect(event.isTerminal).toBe(false);
    });

    it('should track job creation time', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.emitJobStatus({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        status: JobStatus.PENDING,
      });

      const event1 = broadcastSpy.mock.calls[0][0];
      const createdAt1 = event1.job.createdAt;

      // Wait a bit and emit another status
      await new Promise(r => setTimeout(r, 10));

      await service.emitJobStatus({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        status: JobStatus.PROCESSING,
      });

      const event2 = broadcastSpy.mock.calls[1][0];
      const createdAt2 = event2.job.createdAt;

      // Creation time should be the same
      expect(createdAt1).toEqual(createdAt2);
    });

    it('should include metadata in event', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.emitJobStatus({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        status: JobStatus.PROCESSING,
        metadata: {
          userId: 'user_123',
          correlationId: 'corr_123',
          campaignId: 'camp_123',
        },
      });

      const event = broadcastSpy.mock.calls[0][0];
      expect(event.userId).toBe('user_123');
      expect(event.correlationId).toBe('corr_123');
      expect(event.metadata?.campaignId).toBe('camp_123');
    });

    it('should include error in failed job event', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.emitJobStatus({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        status: JobStatus.FAILED,
        error: {
          code: 'ERR_TIMEOUT',
          message: 'Job timed out',
        },
      });

      const event = broadcastSpy.mock.calls[0][0];
      expect(event.job.error).toEqual({
        code: 'ERR_TIMEOUT',
        message: 'Job timed out',
      });
    });
  });

  describe('onAiServiceJobCompleted', () => {
    it('should emit completed status event', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.onAiServiceJobCompleted({
        jobId: 'job_123',
        jobType: JobType.OCR,
        result: { fields: { name: 'John' } },
      });

      const event = broadcastSpy.mock.calls[0][0];
      expect(event.job.status).toBe(JobStatus.COMPLETED);
      expect(event.job.progress).toBe(100);
      expect(event.isTerminal).toBe(true);
    });
  });

  describe('onAiServiceJobFailed', () => {
    it('should emit failed status event', async () => {
      const broadcastSpy = jest.spyOn(broadcaster, 'broadcastJobStatus');

      await service.onAiServiceJobFailed({
        jobId: 'job_123',
        jobType: JobType.INFERENCE,
        error: {
          code: 'ERR_INVALID_INPUT',
          message: 'Invalid input provided',
        },
      });

      const event = broadcastSpy.mock.calls[0][0];
      expect(event.job.status).toBe(JobStatus.FAILED);
      expect(event.isTerminal).toBe(true);
    });
  });
});
