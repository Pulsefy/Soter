import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationType } from './interfaces/notification-job.interface';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../observability/metrics/metrics.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queueMock: jest.Mocked<{ add: jest.Mock }>;
  let loggerMock: { getCorrelationId: jest.Mock };
  let prismaMock: {
    notificationOutbox: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const mockOutbox = {
    id: 'outbox-123',
    type: 'email',
    recipient: 'test@example.com',
    subject: 'Test Subject',
    message: 'Test Message',
    status: 'pending',
    retryCount: 0,
    lastError: null,
    lastAttemptAt: null,
    scheduledFor: new Date(),
    sentAt: null,
    jobId: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    queueMock = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    };
    loggerMock = {
      getCorrelationId: jest.fn().mockReturnValue(undefined),
    };

    prismaMock = {
      notificationOutbox: {
        create: jest.fn().mockResolvedValue(mockOutbox),
        update: jest.fn().mockResolvedValue({
          ...mockOutbox,
          status: 'enqueued',
          jobId: 'job-123',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(mockOutbox),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    prismaMock.$transaction = jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getQueueToken('notifications'),
          useValue: queueMock,
        },
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: LoggerService,
          useValue: loggerMock,
        },
        {
          provide: AuditService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MetricsService,
          useValue: { setNotificationDeadLetterDepth: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendEmail', () => {
    it('should create outbox record before enqueuing', async () => {
      const recipient = 'test@example.com';
      const subject = 'Test Subject';
      const message = 'Test Message';

      // Track call order
      const callOrder: string[] = [];
      prismaMock.notificationOutbox.create.mockImplementation(() => {
        callOrder.push('create');
        return Promise.resolve(mockOutbox);
      });
      queueMock.add.mockImplementation(() => {
        callOrder.push('queue.add');
        return Promise.resolve({ id: 'job-123' });
      });
      prismaMock.notificationOutbox.update.mockImplementation(() => {
        callOrder.push('update');
        return Promise.resolve({
          ...mockOutbox,
          status: 'enqueued',
          jobId: 'job-123',
        });
      });

      await service.sendEmail(recipient, subject, message);

      expect(callOrder).toEqual(['create', 'queue.add', 'update']);
    });

    it('should create outbox record with correct fields', async () => {
      const recipient = 'test@example.com';
      const subject = 'Test Subject';
      const message = 'Test Message';

      await service.sendEmail(recipient, subject, message);

      expect(prismaMock.notificationOutbox.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.EMAIL,
          recipient,
          subject,
          message,
          scheduledFor: expect.any(Date),
        }),
      });
    });

    it('should enqueue job with outboxId in data', async () => {
      await service.sendEmail('test@example.com', 'Subject', 'Message');

      expect(queueMock.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          type: NotificationType.EMAIL,
          outboxId: mockOutbox.id,
        }),
        expect.any(Object),
      );
    });

    it('should default email job correlationId from the active request context', async () => {
      loggerMock.getCorrelationId.mockReturnValue('request-correlation-123');

      await service.sendEmail('test@example.com', 'Subject', 'Message');

      expect(queueMock.add).toHaveBeenCalledWith(
        'send-email',
        expect.objectContaining({
          correlationId: 'request-correlation-123',
        }),
        expect.any(Object),
      );
    });

    it('should configure exponential backoff retries for email jobs', async () => {
      await service.sendEmail('test@example.com', 'Subject', 'Message');

      expect(queueMock.add).toHaveBeenCalledWith(
        'send-email',
        expect.any(Object),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });

    it('should update outbox record to enqueued with jobId after successful enqueue', async () => {
      await service.sendEmail('test@example.com', 'Subject', 'Message');

      expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: mockOutbox.id },
        data: { status: 'enqueued', jobId: 'job-123' },
      });
    });

    it('should return outboxId and jobId', async () => {
      const result = await service.sendEmail(
        'test@example.com',
        'Subject',
        'Message',
      );

      expect(result).toEqual({ outboxId: mockOutbox.id, jobId: 'job-123' });
    });

    it('should leave outbox record in pending status when queue.add throws', async () => {
      queueMock.add.mockRejectedValueOnce(new Error('Redis unavailable'));

      await expect(
        service.sendEmail('test@example.com', 'Subject', 'Message'),
      ).rejects.toThrow('Redis unavailable');

      // update should NOT have been called with enqueued status
      expect(prismaMock.notificationOutbox.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'enqueued' }),
        }),
      );
    });
  });

  describe('sendSms', () => {
    it('should create outbox record before enqueuing', async () => {
      const callOrder: string[] = [];
      prismaMock.notificationOutbox.create.mockImplementation(() => {
        callOrder.push('create');
        return Promise.resolve({ ...mockOutbox, type: 'sms', subject: null });
      });
      queueMock.add.mockImplementation(() => {
        callOrder.push('queue.add');
        return Promise.resolve({ id: 'job-456' });
      });
      prismaMock.notificationOutbox.update.mockImplementation(() => {
        callOrder.push('update');
        return Promise.resolve({
          ...mockOutbox,
          type: 'sms',
          status: 'enqueued',
          jobId: 'job-456',
        });
      });

      await service.sendSms('+1234567890', 'Test SMS');

      expect(callOrder).toEqual(['create', 'queue.add', 'update']);
    });

    it('should create outbox record with SMS type and no subject', async () => {
      const recipient = '+1234567890';
      const message = 'Test SMS';

      await service.sendSms(recipient, message);

      expect(prismaMock.notificationOutbox.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: NotificationType.SMS,
          recipient,
          message,
          scheduledFor: expect.any(Date),
        }),
      });
      // subject should not be in the create call for SMS
      const createCall = prismaMock.notificationOutbox.create.mock.calls[0][0];
      expect(createCall.data).not.toHaveProperty('subject');
    });

    it('should enqueue SMS job with outboxId', async () => {
      await service.sendSms('+1234567890', 'Test SMS');

      expect(queueMock.add).toHaveBeenCalledWith(
        'send-sms',
        expect.objectContaining({
          type: NotificationType.SMS,
          outboxId: mockOutbox.id,
        }),
        expect.any(Object),
      );
    });

    it('should default SMS job correlationId from the active request context', async () => {
      loggerMock.getCorrelationId.mockReturnValue('sms-correlation-123');

      await service.sendSms('+1234567890', 'Test SMS');

      expect(queueMock.add).toHaveBeenCalledWith(
        'send-sms',
        expect.objectContaining({
          correlationId: 'sms-correlation-123',
        }),
        expect.any(Object),
      );
    });

    it('should configure exponential backoff retries for SMS jobs', async () => {
      await service.sendSms('+1234567890', 'Test SMS');

      expect(queueMock.add).toHaveBeenCalledWith(
        'send-sms',
        expect.any(Object),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        }),
      );
    });

    it('should return outboxId and jobId', async () => {
      const result = await service.sendSms('+1234567890', 'Test SMS');

      expect(result).toEqual({ outboxId: mockOutbox.id, jobId: 'job-123' });
    });
  });

  describe('getOutboxRecord', () => {
    it('should return the outbox record for a valid id', async () => {
      const result = await service.getOutboxRecord('outbox-123');

      expect(prismaMock.notificationOutbox.findUnique).toHaveBeenCalledWith({
        where: { id: 'outbox-123' },
      });
      expect(result).toEqual(mockOutbox);
    });

    it('should return null for a non-existent id', async () => {
      prismaMock.notificationOutbox.findUnique.mockResolvedValueOnce(null);

      const result = await service.getOutboxRecord('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getStuckOutboxRecords', () => {
    it('should return empty array when no stuck records exist', async () => {
      prismaMock.notificationOutbox.findMany.mockResolvedValueOnce([]);

      const result = await service.getStuckOutboxRecords();

      expect(result).toEqual([]);
    });

    it('should query for pending and enqueued records older than 10 minutes', async () => {
      await service.getStuckOutboxRecords();

      expect(prismaMock.notificationOutbox.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'enqueued'] },
          scheduledFor: { lt: expect.any(Date) },
        },
        orderBy: { scheduledFor: 'asc' },
      });

      // Verify the cutoff date is approximately 10 minutes ago
      const callArgs = prismaMock.notificationOutbox.findMany.mock.calls[0][0];
      const cutoff: Date = callArgs.where.scheduledFor.lt;
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      expect(Math.abs(cutoff.getTime() - tenMinutesAgo.getTime())).toBeLessThan(
        1000,
      );
    });

    it('should return stuck records ordered by scheduledFor ascending', async () => {
      const stuckRecords = [
        { ...mockOutbox, id: 'old-1', scheduledFor: new Date('2026-01-01') },
        { ...mockOutbox, id: 'old-2', scheduledFor: new Date('2026-01-02') },
      ];
      prismaMock.notificationOutbox.findMany.mockResolvedValueOnce(
        stuckRecords,
      );

      const result = await service.getStuckOutboxRecords();

      expect(result).toEqual(stuckRecords);
    });
  });

  describe('dead-letter replay', () => {
    it('lists dead-lettered records with pagination metadata', async () => {
      const deadLetter = { ...mockOutbox, status: 'dead_letter' };
      prismaMock.notificationOutbox.findMany.mockResolvedValueOnce([
        deadLetter,
      ]);
      prismaMock.notificationOutbox.count.mockResolvedValueOnce(1);

      await expect(service.getDeadLetterNotifications(2, 10)).resolves.toEqual({
        items: [deadLetter],
        total: 1,
        page: 2,
        limit: 10,
      });
      expect(prismaMock.notificationOutbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'dead_letter' },
          skip: 10,
          take: 10,
        }),
      );
    });

    it('claims a dead-letter record once and re-enqueues it', async () => {
      prismaMock.notificationOutbox.findUnique.mockResolvedValueOnce({
        ...mockOutbox,
        status: 'dead_letter',
      });

      await expect(
        service.replayDeadLetterNotification('outbox-123', 'admin-1'),
      ).resolves.toEqual(
        expect.objectContaining({
          success: true,
          outboxId: 'outbox-123',
          replayedJobId: 'job-123',
        }),
      );
      expect(prismaMock.notificationOutbox.updateMany).toHaveBeenCalledWith({
        where: { id: 'outbox-123', status: 'dead_letter' },
        data: {
          status: 'enqueued',
          retryCount: { increment: 1 },
          lastError: null,
        },
      });
    });

    it('does not enqueue when another replay already claimed the record', async () => {
      prismaMock.notificationOutbox.findUnique.mockResolvedValueOnce({
        ...mockOutbox,
        status: 'dead_letter',
      });
      prismaMock.notificationOutbox.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.replayDeadLetterNotification('outbox-123', 'admin-1'),
      ).rejects.toThrow('already in progress');
      expect(queueMock.add).not.toHaveBeenCalled();
    });
  });
});
