import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WebhookService', () => {
  let service: WebhookService;
  let prismaService: PrismaService;
  let mockQueue: {
    add: jest.Mock;
  };

  const mockDelivery = {
    id: 'delivery-123',
    url: 'http://localhost:3002/webhook',
    payload: JSON.stringify({ claimId: 'claim-123' }),
    status: 'pending',
    entityId: 'claim-123',
    entityType: 'claim',
    retryCount: 0,
    lastError: null,
  };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: getQueueToken('webhooks'),
          useValue: mockQueue,
        },
        {
          provide: PrismaService,
          useValue: {
            webhookDelivery: {
              create: jest.fn().mockResolvedValue(mockDelivery),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                VERIFICATION_WEBHOOK_URL: 'http://localhost:3002/webhook',
                WEBHOOK_MAX_ATTEMPTS: '5',
                WEBHOOK_BACKOFF_DELAY_MS: '5000',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('enqueueWebhook', () => {
    it('should create database record and enqueue job', async () => {
      const claimId = 'claim-123';
      const status = 'verified';
      const result = { score: 0.9, confidence: 0.95, details: { factors: [], riskLevel: 'low' } };

      await service.enqueueWebhook(claimId, status, result);

      expect(prismaService.webhookDelivery.create).toHaveBeenCalledWith({
        data: {
          url: 'http://localhost:3002/webhook',
          payload: expect.any(String),
          status: 'pending',
          entityId: claimId,
          entityType: 'claim',
        },
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'deliver',
        { webhookDeliveryId: mockDelivery.id },
        {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );
    });
  });

  describe('replayWebhook', () => {
    it('should reset database record status and enqueue job', async () => {
      jest.spyOn(prismaService.webhookDelivery, 'findUnique').mockResolvedValue(mockDelivery as any);
      jest.spyOn(prismaService.webhookDelivery, 'update').mockResolvedValue({
        ...mockDelivery,
        status: 'pending',
      } as any);

      const result = await service.replayWebhook(mockDelivery.id);

      expect(prismaService.webhookDelivery.findUnique).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
      });

      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
        data: {
          status: 'pending',
          retryCount: 0,
          lastError: null,
        },
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'deliver',
        { webhookDeliveryId: mockDelivery.id },
        {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      );

      expect(result.status).toBe('pending');
    });

    it('should throw NotFoundException if delivery record not found', async () => {
      jest.spyOn(prismaService.webhookDelivery, 'findUnique').mockResolvedValue(null);

      await expect(service.replayWebhook('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });
});
