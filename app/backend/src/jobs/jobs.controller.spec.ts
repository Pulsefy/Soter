import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller';
import { DlqService } from './dlq.service';
import { getQueueToken } from '@nestjs/bullmq';
import { RETENTION_PURGE_QUEUE } from '../retention-policy/retention-purge.processor';
import { HttpException } from '@nestjs/common';
import { Request } from 'express';

describe('JobsController', () => {
  let controller: JobsController;
  let dlqService: any;
  let verificationQueue: any;

  beforeEach(async () => {
    dlqService = {
      getDlqJobs: jest.fn().mockResolvedValue([]),
      getJobHistory: jest.fn().mockResolvedValue({}),
      replayJob: jest.fn().mockResolvedValue({ success: true }),
    };

    verificationQueue = {
      getWaitingCount: jest.fn().mockResolvedValue(0),
      getActiveCount: jest.fn().mockResolvedValue(0),
      getCompletedCount: jest.fn().mockResolvedValue(0),
      getFailedCount: jest.fn().mockResolvedValue(0),
      getDelayedCount: jest.fn().mockResolvedValue(0),
      name: 'verification',
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        { provide: DlqService, useValue: dlqService },
        { provide: getQueueToken('verification'), useValue: verificationQueue },
        {
          provide: getQueueToken('notifications'),
          useValue: verificationQueue,
        },
        { provide: getQueueToken('onchain'), useValue: verificationQueue },
        {
          provide: getQueueToken(RETENTION_PURGE_QUEUE),
          useValue: verificationQueue,
        },
        { provide: getQueueToken('dead-letter'), useValue: verificationQueue },
      ],
    }).compile();

    controller = module.get<JobsController>(JobsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getQueues', () => {
    it('should return queues status', async () => {
      const result = await controller.getQueues();
      expect(result.verification.name).toBe('verification');
    });
  });

  describe('getDlqJobs', () => {
    it('should call dlqService.getDlqJobs with pagination', async () => {
      await controller.getDlqJobs('10', '20');
      expect(dlqService.getDlqJobs).toHaveBeenCalledWith(10, 20);
    });
  });

  describe('getDlqJobHistory', () => {
    it('should call dlqService.getJobHistory', async () => {
      await controller.getDlqJobHistory('123');
      expect(dlqService.getJobHistory).toHaveBeenCalledWith('123');
    });
  });

  describe('replayDlqJob', () => {
    it('should call dlqService.replayJob if user is present', async () => {
      const req = { user: { id: 'admin-1' } } as unknown as Request;
      await controller.replayDlqJob('123', req);
      expect(dlqService.replayJob).toHaveBeenCalledWith('123', 'admin-1');
    });

    it('should throw Unauthorized if no user', async () => {
      const req = {} as unknown as Request;
      await expect(controller.replayDlqJob('123', req)).rejects.toThrow(
        HttpException,
      );
    });
  });
});
