import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { SessionService } from '../session/session.service';
import { WebhooksService } from './webhooks.service';
import { HmacGuard } from './hmac.guard';
import {
  AiVerificationPayloadDto,
  VerificationStatus,
} from '../ai-verification.dto'; // Changed from 'src/ai-verification.dto' to relative import

describe('WebhookController', () => {
  let controller: WebhookController;

  const mockSessionService = {
    submitToStep: jest.fn().mockResolvedValue({ isIdempotent: false }),
  };

  const mockWebhooksService = {
    handleAiVerification: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
        {
          provide: WebhooksService,
          useValue: mockWebhooksService,
        },
      ],
    })
      .overrideGuard(HmacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleAiVerification', () => {
    it('should call webhooksService.handleAiVerification with parsed parameters', async () => {
      const payload: AiVerificationPayloadDto = {
        eventId: 'd9e1b233-8083-4a25-8236-c69a997c306a',
        sessionId: 'session-123',
        status: VerificationStatus.VERIFIED,
        details: { verificationScore: 0.95 },
      };

      const result = await controller.handleAiVerification(payload);

      expect(mockSessionService.submitToStep).toHaveBeenCalledWith(
        payload.sessionId,
        'undefined',
        { submissionKey: payload.eventId, payload: payload.details },
      );

      expect(result).toEqual({ status: 'received', isIdempotent: false });
    });
  });
});
