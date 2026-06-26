import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { Job } from 'bullmq';
import { of, throwError } from 'rxjs';
import { WebhookProcessor } from './webhook.processor';
import { PrismaService } from '../prisma/prisma.service';
import { HmacService } from '../common/hmac/hmac.service';
import { DlqService } from '../jobs/dlq.service';
import { MetricsService } from '../observability/metrics/metrics.service';

describe('WebhookProcessor', () => {
  let processor: WebhookProcessor;
  let prismaService: PrismaService;
  let httpService: HttpService;
  let hmacService: HmacService;
  let dlqService: DlqService;
  let metricsService: MetricsService;

  const mockDelivery = {
    id: 'delivery-123',
    url: 'http://localhost:3002/webhook',
    payload: JSON.stringify({ claimId: 'claim-123', status: 'verified' }),
    status: 'pending',
    entityId: 'claim-123',
    entityType: 'claim',
    retryCount: 0,
    lastError: null,
  };

  const mockJob = {
    id: 'job-123',
    data: { webhookDeliveryId: 'delivery-123' },
    attemptsMade: 0,
    opts: { attempts: 5 },
  } as Job<{ webhookDeliveryId: string }, any, string>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        {
          provide: PrismaService,
          useValue: {
            webhookDelivery: {
              findUnique: jest.fn().mockResolvedValue(mockDelivery),
              update: jest.fn().mockResolvedValue(mockDelivery),
            },
          },
        },
        {
          provide: HttpService,
          useValue: {
            post: jest.fn().mockReturnValue(of({ status: 200, data: {} })),
          },
        },
        {
          provide: HmacService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-signature-hash'),
          },
        },
        {
          provide: DlqService,
          useValue: {
            moveToDlq: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            recordWebhookDeliveryDuration: jest.fn(),
            incrementWebhookRetry: jest.fn(),
            incrementCallbackFailure: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get<WebhookProcessor>(WebhookProcessor);
    prismaService = module.get<PrismaService>(PrismaService);
    httpService = module.get<HttpService>(HttpService);
    hmacService = module.get<HmacService>(HmacService);
    dlqService = module.get<DlqService>(DlqService);
    metricsService = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should process webhook job and deliver successfully', async () => {
      const result = await processor.process(mockJob);

      expect(prismaService.webhookDelivery.findUnique).toHaveBeenCalledWith({
        where: { id: 'delivery-123' },
      });

      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-123' },
        data: { lastAttemptAt: expect.any(Date) },
      });

      expect(hmacService.sign).toHaveBeenCalled();
      expect(httpService.post).toHaveBeenCalledWith(
        mockDelivery.url,
        expect.objectContaining({
          claimId: 'claim-123',
          deliveryId: mockDelivery.id,
          timestamp: expect.any(String),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-webhook-signature': 'mock-signature-hash',
          }),
        }),
      );

      expect(metricsService.recordWebhookDeliveryDuration).toHaveBeenCalledWith(
        'verification_result',
        expect.any(Number),
      );

      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-123' },
        data: {
          status: 'sent',
          sentAt: expect.any(Date),
          retryCount: 0,
        },
      });

      expect(result).toEqual({ success: true, status: 200 });
    });

    it('should skip processing if already sent', async () => {
      jest.spyOn(prismaService.webhookDelivery, 'findUnique').mockResolvedValue({
        ...mockDelivery,
        status: 'sent',
      } as any);

      await processor.process(mockJob);

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should handle request failure, record state, increment metrics, and throw error', async () => {
      jest.spyOn(httpService, 'post').mockReturnValue(
        throwError(() => new Error('Connection refused')),
      );

      await expect(processor.process(mockJob)).rejects.toThrow('Connection refused');

      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-123' },
        data: {
          retryCount: 1,
          lastError: 'Connection refused',
        },
      });

      expect(metricsService.incrementWebhookRetry).toHaveBeenCalledWith(
        'verification_result',
        'Connection refused',
      );
    });
  });

  describe('onFailed', () => {
    it('should mark status as failed, record failure metrics, and send job to DLQ', async () => {
      const error = new Error('Max retries exhausted');

      await processor.onFailed(mockJob, error);

      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-123' },
        data: { status: 'failed' },
      });

      expect(metricsService.incrementCallbackFailure).toHaveBeenCalledWith(
        'webhook_delivery',
        'Max retries exhausted',
      );

      expect(dlqService.moveToDlq).toHaveBeenCalledWith('webhooks', mockJob, error);
    });
  });
});
