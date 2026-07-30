import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { AidService } from './aid/aid.service';
import { WebhookHmacGuard } from './common/guards/webhook-hmac.guard';
import {
  AiVerificationWebhookDto,
  TaskStatus,
} from './webhooks/dto/ai-verification-webhook.dto';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let aidService: { handleTaskWebhook: jest.Mock };

  const payload: AiVerificationWebhookDto = {
    taskId: 'task-1',
    deliveryId: 'delivery-1',
    timestamp: '2024-03-24T10:30:00Z',
    status: TaskStatus.COMPLETED,
    result: { score: 0.9, prediction: 'approved' },
    taskType: 'humanitarian_verification',
    completedAt: '2024-03-24T10:35:00Z',
    schemaVersion: '1.0',
  };

  beforeEach(async () => {
    aidService = {
      handleTaskWebhook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: AidService,
          useValue: aidService,
        },
      ],
    })
      .overrideGuard(WebhookHmacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WebhooksController>(WebhooksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('uses the canonical AI verification webhook handler', async () => {
    aidService.handleTaskWebhook.mockResolvedValue({
      received: true,
      taskId: payload.taskId,
      status: payload.status,
    });

    await expect(controller.handleAiVerification(payload)).resolves.toEqual({
      received: true,
      taskId: payload.taskId,
      status: payload.status,
    });

    expect(aidService.handleTaskWebhook).toHaveBeenCalledWith(payload);
  });

  it('returns the idempotent replay response from the canonical handler', async () => {
    aidService.handleTaskWebhook.mockResolvedValue({
      received: true,
      status: 'ignored',
      reason: 'duplicate_delivery',
    });

    await expect(controller.handleAiVerification(payload)).resolves.toEqual({
      received: true,
      status: 'ignored',
      reason: 'duplicate_delivery',
    });
  });
});
