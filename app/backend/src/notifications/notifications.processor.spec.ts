import { Test, TestingModule } from '@nestjs/testing';
import { NotificationProcessor } from './notifications.processor';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from './interfaces/notification-job.interface';
import { Job } from 'bullmq';
import { DlqService } from '../jobs/dlq.service';

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let prismaMock: {
    notificationOutbox: {
      update: jest.Mock;
    };
  };

  const makeJob = (
    overrides: Partial<{
      outboxId: string;
      type: string;
      recipient: string;
      message: string;
    }> = {},
  ): Job<any, any, string> =>
    ({
      id: 'job-test-1',
      data: {
        type: NotificationType.EMAIL,
        recipient: 'test@example.com',
        message: 'Test message',
        timestamp: Date.now(),
        outboxId: 'outbox-test-1',
        ...overrides,
      },
      attemptsMade: 0,
    }) as unknown as Job<any, any, string>;

  beforeEach(async () => {
    prismaMock = {
      notificationOutbox: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: DlqService,
          useValue: {
            moveToDlq: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<NotificationProcessor>(NotificationProcessor);
  });

  describe('process', () => {
    it('should call prisma.update with lastAttemptAt when outboxId is present', async () => {
      const job = makeJob({ outboxId: 'outbox-abc' });

      await processor.process(job);

      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-abc' },
        data: { lastAttemptAt: expect.any(Date) },
      });
    });

    it('should log a warning and not throw when outboxId is absent', async () => {
      const job = makeJob({ outboxId: undefined });
      // Remove outboxId entirely
      delete job.data.outboxId;

      await expect(processor.process(job)).resolves.toBeDefined();
      expect(prismaMock.notificationOutbox.update).not.toHaveBeenCalled();
    });

    it('should return a successful NotificationResult', async () => {
      const job = makeJob();

      const result = await processor.process(job);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should log correlationId when present in job data', async () => {
      const logSpy = jest.spyOn(processor['logger'], 'log');
      const job = makeJob({ outboxId: 'outbox-abc' });
      job.data.correlationId = 'test-correlation-id';

      await processor.process(job);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('test-correlation-id'),
      );
    });

    it('should re-throw when prisma.update throws during process', async () => {
      prismaMock.notificationOutbox.update.mockRejectedValueOnce(
        new Error('DB error'),
      );
      const job = makeJob({ outboxId: 'outbox-abc' });

      await expect(processor.process(job)).rejects.toThrow('DB error');
    });
  });

  describe('onCompleted', () => {
    it('should update outbox record to sent with sentAt when outboxId is present', async () => {
      const job = makeJob({ outboxId: 'outbox-abc' });

      await processor.onCompleted(job);

      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-abc' },
        data: {
          status: 'sent',
          sentAt: expect.any(Date),
        },
      });
    });

    it('should log a warning and not throw when outboxId is absent', async () => {
      const job = makeJob();
      delete job.data.outboxId;

      await expect(processor.onCompleted(job)).resolves.toBeUndefined();
      expect(prismaMock.notificationOutbox.update).not.toHaveBeenCalled();
    });

    it('should swallow prisma errors and not throw', async () => {
      prismaMock.notificationOutbox.update.mockRejectedValueOnce(
        new Error('DB error'),
      );
      const job = makeJob({ outboxId: 'outbox-abc' });

      await expect(processor.onCompleted(job)).resolves.toBeUndefined();
    });
  });

  describe('onFailed', () => {
    it('should update outbox record to failed with retryCount increment and lastError when outboxId is present', async () => {
      const job = makeJob({ outboxId: 'outbox-abc' });
      const error = new Error('Something went wrong');

      await processor.onFailed(job, error);

      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-abc' },
        data: {
          status: 'failed',
          retryCount: { increment: 1 },
          lastError: 'Something went wrong',
        },
      });
    });

    it('should log a warning and not throw when outboxId is absent', async () => {
      const job = makeJob();
      delete job.data.outboxId;
      const error = new Error('Job failed');

      await expect(processor.onFailed(job, error)).resolves.toBeUndefined();
      expect(prismaMock.notificationOutbox.update).not.toHaveBeenCalled();
    });

    it('should handle undefined job gracefully', async () => {
      const error = new Error('Job failed');

      await expect(
        processor.onFailed(undefined, error),
      ).resolves.toBeUndefined();
      expect(prismaMock.notificationOutbox.update).not.toHaveBeenCalled();
    });

    it('should swallow prisma errors and not throw', async () => {
      prismaMock.notificationOutbox.update.mockRejectedValueOnce(
        new Error('DB error'),
      );
      const job = makeJob({ outboxId: 'outbox-abc' });
      const error = new Error('Job failed');

      await expect(processor.onFailed(job, error)).resolves.toBeUndefined();
    });
  });
});
