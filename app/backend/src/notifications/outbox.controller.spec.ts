import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OutboxController } from './outbox.controller';
import { NotificationsService } from './notifications.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';

describe('OutboxController', () => {
  let controller: OutboxController;
  let notificationsServiceMock: jest.Mocked<
    Pick<NotificationsService, 'getStuckOutboxRecords' | 'getOutboxRecord'>
  >;

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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    notificationsServiceMock = {
      getStuckOutboxRecords: jest.fn().mockResolvedValue([mockRecord]),
      getOutboxRecord: jest.fn().mockResolvedValue(mockRecord),
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
      const result = await controller.listStuck();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([mockRecord]);
      expect(notificationsServiceMock.getStuckOutboxRecords).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array when no stuck records exist', async () => {
      notificationsServiceMock.getStuckOutboxRecords.mockResolvedValueOnce([]);

      const result = await controller.listStuck();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('GET /notifications/outbox/:id (getOne)', () => {
    it('should return 200 with the record for a valid id', async () => {
      const result = await controller.getOne('outbox-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockRecord);
      expect(notificationsServiceMock.getOutboxRecord).toHaveBeenCalledWith('outbox-123');
    });

    it('should throw NotFoundException for a non-existent id', async () => {
      notificationsServiceMock.getOutboxRecord.mockResolvedValueOnce(null);

      await expect(controller.getOne('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should include the id in the NotFoundException message', async () => {
      notificationsServiceMock.getOutboxRecord.mockResolvedValueOnce(null);

      await expect(controller.getOne('missing-id')).rejects.toThrow(
        'Outbox record with id "missing-id" not found',
      );
    });
  });
});
