import { AppException } from '../common/dto/error-response.dto';
import { Test, TestingModule } from '@nestjs/testing';
import { Request as ExpressRequest } from 'express';

import { OutboxController } from './outbox.controller';
import { NotificationsService } from './notifications.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';

type OutboxServiceMethods = Pick<
  NotificationsService,
  | 'getStuckOutboxRecords'
  | 'getOutboxRecord'
  | 'getDeadLetterNotifications'
  | 'replayDeadLetterNotification'
  | 'replayDeadLetterNotifications'
  | 'getDeliveryAttempts'
  | 'getDeliveryHistory'
>;

/** Platform admin: no organisation, so no tenant scoping is applied. */
const adminRequest = {
  user: { role: 'admin', apiKeyId: 'admin-key' },
} as unknown as ExpressRequest;

/** Operator bound to Org A. */
const orgARequest = {
  user: { role: 'operator', orgId: 'org-a', apiKeyId: 'key-a' },
} as unknown as ExpressRequest;

describe('OutboxController', () => {
  let controller: OutboxController;
  let notificationsServiceMock: jest.Mocked<OutboxServiceMethods>;

  const mockRecord = {
    id: 'outbox-123',
    type: 'email',
    recipient: 'test@example.com',
    subject: 'Test Subject',
    message: 'Test Message',
    status: 'pending',
    retryCount: 0,
    lastError: null,
    lastAttemptAt: null,
    scheduledFor: new Date('2026-01-01T00:00:00Z'),
    sentAt: null,
    jobId: null,
    metadata: null,
    orgId: 'org-a',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    notificationsServiceMock = {
      getStuckOutboxRecords: jest.fn().mockResolvedValue([mockRecord]),
      getOutboxRecord: jest.fn().mockResolvedValue(mockRecord),
      getDeadLetterNotifications: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 50,
      }),
      replayDeadLetterNotification: jest.fn().mockResolvedValue({
        success: true,
        outboxId: 'outbox-123',
        replayedJobId: 'job-1',
      }),
      replayDeadLetterNotifications: jest.fn().mockResolvedValue({
        replayed: 1,
        skipped: 0,
        results: [],
      }),
      getDeliveryAttempts: jest.fn().mockResolvedValue([]),
      getDeliveryHistory: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OutboxController],
      providers: [
        {
          provide: NotificationsService,
          useValue: notificationsServiceMock,
        },
      ],
    })
      // Override guards so we can test controller logic in isolation
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OutboxController>(OutboxController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /notifications/outbox (listStuck)', () => {
    it('should return 200 with stuck records', async () => {
      const result = await controller.listStuck(adminRequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([mockRecord]);
      expect(
        notificationsServiceMock.getStuckOutboxRecords,
      ).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array when no stuck records exist', async () => {
      notificationsServiceMock.getStuckOutboxRecords.mockResolvedValueOnce([]);

      const result = await controller.listStuck(adminRequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should scope the list to the caller organisation', async () => {
      await controller.listStuck(orgARequest);

      expect(
        notificationsServiceMock.getStuckOutboxRecords,
      ).toHaveBeenCalledWith('org-a');
    });

    it('should not scope the list for platform admins', async () => {
      await controller.listStuck(adminRequest);

      expect(
        notificationsServiceMock.getStuckOutboxRecords,
      ).toHaveBeenCalledWith(undefined);
    });
  });

  describe('GET /notifications/outbox/dead-letter', () => {
    it('should scope the dead-letter list to the caller organisation', async () => {
      await controller.listDeadLetter(orgARequest, '2', '10');

      expect(
        notificationsServiceMock.getDeadLetterNotifications,
      ).toHaveBeenCalledWith(2, 10, 'org-a');
    });
  });

  describe('POST /notifications/outbox/dead-letter/:id/replay', () => {
    it('should pass the caller organisation and actor to the replay', async () => {
      await controller.replayDeadLetter('outbox-123', orgARequest);

      expect(
        notificationsServiceMock.replayDeadLetterNotification,
      ).toHaveBeenCalledWith('outbox-123', 'key-a', 'org-a');
    });

    it('should deny replay of another organisation record without leaking it', async () => {
      notificationsServiceMock.replayDeadLetterNotification.mockRejectedValueOnce(
        new AppException(
          'NOT_FOUND',
          404,
          'Outbox record with id "foreign-1" not found',
        ),
      );

      await expect(
        controller.replayDeadLetter('foreign-1', orgARequest),
      ).rejects.toThrow(AppException);
    });
  });

  describe('POST /notifications/outbox/dead-letter/replay', () => {
    it('should scope the bulk replay to the caller organisation', async () => {
      await controller.replayDeadLetters({ ids: ['one', 'two'] }, orgARequest);

      expect(
        notificationsServiceMock.replayDeadLetterNotifications,
      ).toHaveBeenCalledWith(['one', 'two'], 'key-a', 'org-a');
    });
  });

  describe('GET /notifications/outbox/delivery-attempts', () => {
    it('should scope the delivery history to the caller organisation', async () => {
      await controller.listDeliveryAttempts(orgARequest, 'failed');

      expect(notificationsServiceMock.getDeliveryHistory).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failed' }),
        'org-a',
      );
    });
  });

  describe('GET /notifications/outbox/:id (getOne)', () => {
    it('should return 200 with the record for a valid id', async () => {
      const result = await controller.getOne('outbox-123', orgARequest);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockRecord);
      expect(notificationsServiceMock.getOutboxRecord).toHaveBeenCalledWith(
        'outbox-123',
        'org-a',
      );
    });

    it('should throw NotFoundException for a non-existent id', async () => {
      notificationsServiceMock.getOutboxRecord.mockResolvedValueOnce(null);

      await expect(
        controller.getOne('non-existent', orgARequest),
      ).rejects.toThrow(AppException);
    });

    it('should include the id in the NotFoundException message', async () => {
      notificationsServiceMock.getOutboxRecord.mockResolvedValueOnce(null);

      await expect(
        controller.getOne('missing-id', orgARequest),
      ).rejects.toThrow('Outbox record with id "missing-id" not found');
    });

    it('should treat a cross-organisation record as not found', async () => {
      // The org-scoped service lookup cannot see foreign records at all.
      notificationsServiceMock.getOutboxRecord.mockResolvedValueOnce(null);

      await expect(controller.getOne('foreign-1', orgARequest)).rejects.toThrow(
        AppException,
      );
      expect(notificationsServiceMock.getOutboxRecord).toHaveBeenCalledWith(
        'foreign-1',
        'org-a',
      );
    });

    it('should not scope the lookup for platform admins', async () => {
      await controller.getOne('outbox-123', adminRequest);

      expect(notificationsServiceMock.getOutboxRecord).toHaveBeenCalledWith(
        'outbox-123',
        undefined,
      );
    });
  });

  describe('GET /notifications/outbox/:id/attempts', () => {
    it('should not return attempts for a foreign record', async () => {
      notificationsServiceMock.getOutboxRecord.mockResolvedValueOnce(null);

      await expect(
        controller.getAttempts('foreign-1', orgARequest),
      ).rejects.toThrow(AppException);
      expect(
        notificationsServiceMock.getDeliveryAttempts,
      ).not.toHaveBeenCalled();
    });

    it('should scope attempts to the caller organisation', async () => {
      await controller.getAttempts('outbox-123', orgARequest);

      expect(notificationsServiceMock.getDeliveryAttempts).toHaveBeenCalledWith(
        'outbox-123',
        'org-a',
      );
    });
  });
});
