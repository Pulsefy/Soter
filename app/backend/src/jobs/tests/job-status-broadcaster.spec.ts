/**
 * Job Status Broadcaster Tests
 * Tests Redis Pub/Sub broadcasting and history management
 */

import { Test, TestingModule } from '@nestjs/testing';
import { v4 as uuidv4 } from 'uuid';

import { REDIS_CLIENT } from '../../redis/redis.module';
import { JobStatusBroadcaster } from '../services/job-status-broadcaster.service';
import {
  JobStatusEvent,
  JobStatus,
  JobType,
} from '../dtos/job-status-event.dto';

describe('JobStatusBroadcaster', () => {
  let service: JobStatusBroadcaster;
  let mockRedis: any;

  beforeEach(async () => {
    // Mock Redis
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
      hdel: jest.fn().mockResolvedValue(1),
      hlen: jest.fn().mockResolvedValue(0),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
      llen: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobStatusBroadcaster,
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<JobStatusBroadcaster>(JobStatusBroadcaster);
  });

  describe('broadcastJobStatus', () => {
    it('should broadcast event to job-specific channel', async () => {
      const event: JobStatusEvent = {
        eventId: uuidv4(),
        job: {
          id: 'job_123',
          type: JobType.INFERENCE,
          status: JobStatus.PROCESSING,
          progress: 50,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        emittedAt: new Date(),
        isTerminal: false,
      };

      await service.broadcastJobStatus(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'job_status:job_123',
        expect.stringContaining('job_123'),
      );
    });

    it('should broadcast event to broadcast channel', async () => {
      const event: JobStatusEvent = {
        eventId: uuidv4(),
        job: {
          id: 'job_123',
          type: JobType.OCR,
          status: JobStatus.COMPLETED,
          result: { data: 'test' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        emittedAt: new Date(),
        isTerminal: true,
      };

      await service.broadcastJobStatus(event);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'job_status:broadcast',
        expect.stringContaining('job_123'),
      );
    });

    it('should store event in history', async () => {
      const event: JobStatusEvent = {
        eventId: uuidv4(),
        job: {
          id: 'job_123',
          type: JobType.INFERENCE,
          status: JobStatus.PROCESSING,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        emittedAt: new Date(),
        isTerminal: false,
      };

      const pipeline = mockRedis.pipeline();
      await service.broadcastJobStatus(event);

      expect(pipeline.lpush).toHaveBeenCalled();
      expect(pipeline.ltrim).toHaveBeenCalled();
      expect(pipeline.expire).toHaveBeenCalled();
    });
  });

  describe('getJobHistory', () => {
    it('should retrieve job history from Redis', async () => {
      const event: JobStatusEvent = {
        eventId: uuidv4(),
        job: {
          id: 'job_123',
          type: JobType.INFERENCE,
          status: JobStatus.PROCESSING,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        emittedAt: new Date(),
        isTerminal: false,
      };

      mockRedis.lrange.mockResolvedValue([JSON.stringify(event)]);

      const history = await service.getJobHistory('job_123');

      expect(history).toHaveLength(1);
      expect(history[0].job.id).toBe('job_123');
    });

    it('should return empty array on Redis error', async () => {
      mockRedis.lrange.mockRejectedValue(new Error('Redis error'));

      const history = await service.getJobHistory('job_123');

      expect(history).toEqual([]);
    });

    it('should limit history results', async () => {
      const events = Array(100)
        .fill(null)
        .map(() => ({
          eventId: uuidv4(),
          job: {
            id: 'job_123',
            type: JobType.INFERENCE,
            status: JobStatus.PROCESSING,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          emittedAt: new Date(),
          isTerminal: false,
        }));

      mockRedis.lrange.mockResolvedValue(events.map(e => JSON.stringify(e)));

      await service.getJobHistory('job_123', 50);

      expect(mockRedis.lrange).toHaveBeenCalledWith(
        'job_status_history:job_123',
        0,
        49,
      );
    });
  });

  describe('recordSubscription', () => {
    it('should record subscription in Redis', async () => {
      const subscriptionId = uuidv4();
      const jobId = 'job_123';

      await service.recordSubscription(jobId, subscriptionId, 'user_123', 3600);

      expect(mockRedis.hset).toHaveBeenCalledWith(
        'job_subscriptions:job_123',
        subscriptionId,
        expect.stringContaining(subscriptionId),
      );
      expect(mockRedis.expire).toHaveBeenCalled();
    });
  });

  describe('removeSubscription', () => {
    it('should remove subscription from Redis', async () => {
      const subscriptionId = uuidv4();
      const jobId = 'job_123';

      await service.removeSubscription(jobId, subscriptionId);

      expect(mockRedis.hdel).toHaveBeenCalledWith(
        'job_subscriptions:job_123',
        subscriptionId,
      );
    });
  });

  describe('getSubscriptionCount', () => {
    it('should return subscription count', async () => {
      mockRedis.hlen.mockResolvedValue(5);

      const count = await service.getSubscriptionCount('job_123');

      expect(count).toBe(5);
    });

    it('should return 0 on error', async () => {
      mockRedis.hlen.mockRejectedValue(new Error('Redis error'));

      const count = await service.getSubscriptionCount('job_123');

      expect(count).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return metrics about streaming state', async () => {
      mockRedis.keys.mockResolvedValueOnce([
        'job_status_history:job_1',
        'job_status_history:job_2',
      ]);
      mockRedis.keys.mockResolvedValueOnce(['job_subscriptions:job_1']);
      mockRedis.llen.mockResolvedValue(10);
      mockRedis.hlen.mockResolvedValue(3);

      const metrics = await service.getMetrics();

      expect(metrics).toHaveProperty('historyRecords');
      expect(metrics).toHaveProperty('totalHistoryEvents');
      expect(metrics).toHaveProperty('subscriptionHolders');
      expect(metrics).toHaveProperty('totalActiveSubscriptions');
    });
  });
});
