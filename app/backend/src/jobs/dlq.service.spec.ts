import { Test, TestingModule } from '@nestjs/testing';
import { DlqService } from './dlq.service';
import { getQueueToken } from '@nestjs/bullmq';
import { RETENTION_PURGE_QUEUE } from '../retention-policy/retention-purge.processor';
import { AuditService } from '../audit/audit.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Job } from 'bullmq';

describe('DlqService', () => {
  let service: DlqService;
  let dlqQueue: any;
  let verificationQueue: any;
  let auditService: any;

  beforeEach(async () => {
    dlqQueue = {
      add: jest.fn(),
      getJobs: jest.fn(),
      getJob: jest.fn(),
    };
    verificationQueue = {
      add: jest.fn(),
    };
    auditService = {
      record: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DlqService,
        { provide: getQueueToken('dead-letter'), useValue: dlqQueue },
        { provide: getQueueToken('verification'), useValue: verificationQueue },
        { provide: getQueueToken('notifications'), useValue: {} },
        { provide: getQueueToken('onchain'), useValue: {} },
        { provide: getQueueToken(RETENTION_PURGE_QUEUE), useValue: {} },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<DlqService>(DlqService);
  });

  describe('moveToDlq', () => {
    it('should add to dlq if attempts exhausted', async () => {
      const mockJob = {
        id: 'job-1',
        opts: { attempts: 3 },
        attemptsMade: 3,
        data: { foo: 'bar' },
      } as unknown as Job;

      await service.moveToDlq('verification', mockJob, new Error('failed'));
      expect(dlqQueue.add).toHaveBeenCalledWith(
        'dlq-verification',
        expect.objectContaining({
          originalId: 'job-1',
          originalQueue: 'verification',
          failedReason: 'failed',
        }),
      );
    });
  });

  describe('replayJob', () => {
    it('should replay a job successfully', async () => {
      const mockJob = {
        id: 'dlq-job-1',
        data: {
          originalId: 'job-1',
          originalQueue: 'verification',
          data: { foo: 'bar' },
        },
        remove: jest.fn(),
      } as unknown as Job;

      dlqQueue.getJob.mockResolvedValue(mockJob);
      verificationQueue.add.mockResolvedValue({ id: 'new-job-1' });

      const result = await service.replayJob('dlq-job-1', 'admin-1');

      expect(result.success).toBe(true);
      expect(verificationQueue.add).toHaveBeenCalledWith('job-1', {
        foo: 'bar',
      });
      expect(mockJob.remove).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-1',
          entity: 'Job',
          entityId: 'dlq-job-1',
          action: 'replay_dlq_job',
          metadata: {
            originalQueue: 'verification',
            originalId: 'job-1',
            newJobId: 'new-job-1',
          },
        }),
      );
    });

    it('should throw NotFoundException if job not found in DLQ', async () => {
      dlqQueue.getJob.mockResolvedValue(null);
      await expect(service.replayJob('unknown', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if missing originalQueue', async () => {
      const mockJob = {
        id: 'dlq-job-1',
        data: {}, // no originalQueue
        remove: jest.fn(),
      } as unknown as Job;
      dlqQueue.getJob.mockResolvedValue(mockJob);

      await expect(service.replayJob('dlq-job-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if queue not recognized', async () => {
      const mockJob = {
        id: 'dlq-job-1',
        data: { originalQueue: 'invalid-queue' },
        remove: jest.fn(),
      } as unknown as Job;
      dlqQueue.getJob.mockResolvedValue(mockJob);

      await expect(service.replayJob('dlq-job-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
