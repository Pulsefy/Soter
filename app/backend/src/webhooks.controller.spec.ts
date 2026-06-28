import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { HmacAuthGuard } from './hmac-auth.guard';
import {
  AiVerificationPayloadDto,
  VerificationStatus,
} from 'src/ai-verification.dto';
import { ConfigService } from '@nestjs/config';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: WebhooksService;

  const mockWebhooksService = {
    processAiVerification: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: WebhooksService,
          useValue: mockWebhooksService,
        },
        // Mock ConfigService for the guard
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-secret'),
          },
        },
      ],
    })
      .overrideGuard(HmacAuthGuard)
      .useValue({ canActivate: () => true }) // Mock the guard to always pass
      .compile();

    controller = module.get<WebhooksController>(WebhooksController);
    service = module.get<WebhooksService>(WebhooksService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleAiVerification', () => {
    it('should call the service with the correct payload', async () => {
      const payload: AiVerificationPayloadDto = {
        eventId: 'evt_123',
        sessionId: 'sess_456',
        status: VerificationStatus.VERIFIED,
        details: { score: 0.9 },
      };

      await controller.handleAiVerification(payload);

      expect(service.processAiVerification).toHaveBeenCalledWith(payload);
    });
  });
});
