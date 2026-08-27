import { Test, TestingModule } from '@nestjs/testing';
import { NotificationProcessor } from './notifications.processor';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from './interfaces/notification-job.interface';
import { Job } from 'bullmq';
import { DlqService } from '../jobs/dlq.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { DeliveryAdapterFactory } from './adapters/delivery-adapter.factory';
import { IDeliveryAdapter } from './adapters/delivery-adapter.interface';

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let prismaMock: {
    notificationOutbox: {
      update: jest.Mock;
    };
    notificationDeliveryAttempt: {
      create: jest.Mock;
    };
  };
  let metricsMock: {
    incrementCallbackFailure: jest.Mock;
    incrementNotificationDeliveryAttempt: jest.Mock;
    incrementNotificationDeliveryFailureByCategory: jest.Mock;
  };
  let adapterFactoryMock: {
    getAdapter: jest.Mock;
  };
  let mockAdapter: jest.Mocked<IDeliveryAdapter>;

  const makeJob = (
    overrides: Partial<{
      outboxId: string;
      type: string;
      recipient: string;
      message: string;
      subject: string;
    }> = {},
  ): Job<any, any, string> =>
    ({
      id: 'job-test-1',
      data: {
        type: NotificationType.EMAIL,
        recipient: 'test@example.com',
        subject: 'Test Subject',
        message: 'Test message',
        timestamp: Date.now(),
        outboxId: 'outbox-test-1',
        ...overrides,
      },
      attemptsMade: 0,
      returnvalue: undefined,
    }) as unknown as Job<any, any, string>;

  beforeEach(async () => {
    prismaMock = {
      notificationOutbox: {
        update: jest.fn().mockResolvedValue({}),
      },
      notificationDeliveryAttempt: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    metricsMock = {
      incrementCallbackFailure: jest.fn(),
      incrementNotificationDeliveryAttempt: jest.fn(),
      incrementNotificationDeliveryFailureByCategory: jest.fn(),
    };

    mockAdapter = {
      getType: jest.fn().mockReturnValue(NotificationType.EMAIL),
      sendEmail: jest.fn().mockResolvedValue({
        success: true,
        providerMessageId: 'mock-msg-123',
        metadata: { provider: 'mock' },
      }),
      sendSms: jest.fn().mockResolvedValue({
        success: true,
        providerMessageId: 'mock-sms-123',
        metadata: { provider: 'mock' },
      }),
    };

    adapterFactoryMock = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
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
        {
          provide: MetricsService,
          useValue: metricsMock,
        },
        {
          provide: DeliveryAdapterFactory,
          useValue: adapterFactoryMock,
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

    it('should return a successful NotificationResult with providerMessageId', async () => {
      const job = makeJob();

      const result = await processor.process(job);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('mock-msg-123');
      expect(adapterFactoryMock.getAdapter).toHaveBeenCalledWith(
        NotificationType.EMAIL,
      );
      expect(mockAdapter.sendEmail).toHaveBeenCalledWith({
        recipient: 'test@example.com',
        subject: 'Test Subject',
        message: 'Test message',
      });
    });

    it('should use SMS adapter for SMS notifications', async () => {
      const job = makeJob({ type: NotificationType.SMS });

      const result = await processor.process(job);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('mock-sms-123');
      expect(adapterFactoryMock.getAdapter).toHaveBeenCalledWith(
        NotificationType.SMS,
      );
      expect(mockAdapter.sendSms).toHaveBeenCalledWith({
        recipient: 'test@example.com',
        message: 'Test message',
      });
    });

    it('should throw when adapter returns failure', async () => {
      mockAdapter.sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'Provider error',
      });
      const job = makeJob();

      await expect(processor.process(job)).rejects.toThrow('Provider error');
      expect(metricsMock.incrementCallbackFailure).toHaveBeenCalledWith(
        'notification_delivery',
        'Provider error',
      );
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
    it('should update outbox record to sent with sentAt and providerMessageId when outboxId is present', async () => {
      const job = makeJob({ outboxId: 'outbox-abc' });
      job.returnvalue = { success: true, messageId: 'provider-msg-123' };

      await processor.onCompleted(job);

      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-abc' },
        data: {
          status: 'sent',
          sentAt: expect.any(Date),
          providerMessageId: 'provider-msg-123',
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
    it('should update outbox record to failed with retryCount increment and lastError when outboxId is present and exhausted', async () => {
      const job = makeJob({ outboxId: 'outbox-abc' });
      job.opts = { attempts: 1 };
      job.attemptsMade = 1;
      const error = new Error('Something went wrong');

      await processor.onFailed(job, error);

      expect(metricsMock.incrementCallbackFailure).toHaveBeenCalledWith(
        'notification_job',
        'Something went wrong',
      );

      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-abc' },
        data: {
          status: 'failed',
          retryCount: { increment: 1 },
          lastError: 'Something went wrong',
        },
      });
    });

    it('should keep status enqueued while retries remain and still increment retryCount', async () => {
      const job = makeJob({ outboxId: 'outbox-abc' });
      job.opts = { attempts: 3 };
      job.attemptsMade = 1;
      const error = new Error('Temporary failure');

      await processor.onFailed(job, error);

      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-abc' },
        data: {
          status: 'enqueued',
          retryCount: { increment: 1 },
          lastError: 'Temporary failure',
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
