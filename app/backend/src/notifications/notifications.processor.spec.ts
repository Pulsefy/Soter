import { Test, TestingModule } from '@nestjs/testing';
import { NotificationProcessor } from './notifications.processor';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from './interfaces/notification-job.interface';
import { Job } from 'bullmq';
import { DlqService } from '../jobs/dlq.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  NotificationBackpressureService,
  ProviderCircuitOpenError,
} from './notification-backpressure.service';
import {
  EMAIL_ADAPTER,
  SMS_ADAPTER,
} from './adapters/delivery-adapter.interface';

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
    setNotificationDeadLetterDepth: jest.Mock;
  };
  let backpressureMock: {
    assertAttemptAllowed: jest.Mock;
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };
  let emailAdapterMock: {
    send: jest.Mock;
  };
  let smsAdapterMock: {
    send: jest.Mock;
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
        count: jest.fn().mockResolvedValue(0),
      },
      notificationDeliveryAttempt: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    metricsMock = {
      incrementCallbackFailure: jest.fn(),
      incrementNotificationDeliveryAttempt: jest.fn(),
      incrementNotificationDeliveryFailureByCategory: jest.fn(),
      setNotificationDeadLetterDepth: jest.fn(),
    };
    backpressureMock = {
      assertAttemptAllowed: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    emailAdapterMock = {
      send: jest.fn().mockResolvedValue({
        success: true,
        providerMessageId: 'sg-msg-id-123',
      }),
    };
    smsAdapterMock = {
      send: jest.fn().mockResolvedValue({
        success: true,
        providerMessageId: 'tw-msg-id-123',
      }),
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
          provide: NotificationBackpressureService,
          useValue: backpressureMock,
        },
        {
          provide: EMAIL_ADAPTER,
          useValue: emailAdapterMock,
        },
        {
          provide: SMS_ADAPTER,
          useValue: smsAdapterMock,
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

    it('should check the circuit breaker before touching the provider', async () => {
      const callOrder: string[] = [];
      backpressureMock.assertAttemptAllowed.mockImplementation(() => {
        callOrder.push('gate');
      });
      emailAdapterMock.send.mockImplementation(() => {
        callOrder.push('send');
        return Promise.resolve({ success: true, providerMessageId: 'msg-1' });
      });

      await processor.process(makeJob());

      expect(backpressureMock.assertAttemptAllowed).toHaveBeenCalledWith(
        'email',
      );
      expect(callOrder).toEqual(['gate', 'send']);
    });

    it('should skip the provider entirely while the circuit is cut off', async () => {
      backpressureMock.assertAttemptAllowed.mockImplementation(() => {
        throw new ProviderCircuitOpenError('email', 30_000);
      });
      const job = makeJob({ outboxId: 'outbox-abc' });

      await expect(processor.process(job)).rejects.toBeInstanceOf(
        ProviderCircuitOpenError,
      );

      expect(emailAdapterMock.send).not.toHaveBeenCalled();
      expect(backpressureMock.recordFailure).not.toHaveBeenCalled();
      expect(prismaMock.notificationOutbox.update).not.toHaveBeenCalled();
    });

    it('should record a successful delivery against the provider circuit', async () => {
      await processor.process(makeJob());

      expect(backpressureMock.recordSuccess).toHaveBeenCalledWith('email');
      expect(backpressureMock.recordFailure).not.toHaveBeenCalled();
    });

    it('should record a failed delivery attempt against the provider circuit', async () => {
      emailAdapterMock.send.mockResolvedValue({
        success: false,
        error: 'SMTP unavailable',
      });
      const job = makeJob();

      await expect(processor.process(job)).rejects.toThrow('SMTP unavailable');

      expect(backpressureMock.recordFailure).toHaveBeenCalledWith('email');
      expect(backpressureMock.recordSuccess).not.toHaveBeenCalled();
    });

    it('should route SMS jobs to the sms provider circuit', async () => {
      const job = makeJob({ type: NotificationType.SMS });

      await processor.process(job);

      expect(backpressureMock.assertAttemptAllowed).toHaveBeenCalledWith('sms');
      expect(backpressureMock.recordSuccess).toHaveBeenCalledWith('sms');
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
    it('should move the outbox record to dead_letter with retryCount increment and lastError when exhausted', async () => {
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
          status: 'dead_letter',
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

    it('should not count a circuit-breaker holdback as a delivery failure', async () => {
      const job = makeJob({ outboxId: 'outbox-abc' });
      job.opts = { attempts: 8 };
      job.attemptsMade = 2;
      const error = new ProviderCircuitOpenError('email', 60_000);

      await processor.onFailed(job, error);

      // The outbox still records the retry, but no provider was contacted so
      // no delivery-failure bookkeeping may happen.
      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'outbox-abc' },
        data: {
          status: 'enqueued',
          retryCount: { increment: 1 },
          lastError: expect.stringContaining('circuit-broken'),
        },
      });
      expect(metricsMock.incrementCallbackFailure).not.toHaveBeenCalled();
      expect(
        metricsMock.incrementNotificationDeliveryAttempt,
      ).not.toHaveBeenCalled();
      expect(
        metricsMock.incrementNotificationDeliveryFailureByCategory,
      ).not.toHaveBeenCalled();
      expect(
        prismaMock.notificationDeliveryAttempt.create,
      ).not.toHaveBeenCalled();
    });
  });
});
