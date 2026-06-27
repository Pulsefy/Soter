import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller';
import { SessionService } from '../session/session.service';
import { HmacGuard } from './hmac.guard';
import {
  AiVerificationPayloadDto,
  VerificationStatus,
} from './dto/ai-verification.dto';

describe('WebhookController', () => {
  let controller: WebhookController;
  let sessionService: SessionService;

  const mockSessionService = {
    submitToStep: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
      ],
    })
      .overrideGuard(HmacGuard)
      .useValue({ canActivate: () => true }) // Mock the guard to always pass
      .compile();

    controller = module.get<WebhookController>(WebhookController);
    sessionService = module.get<SessionService>(SessionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleAiVerification', () => {
    it('should call sessionService.submitToStep with the correct parameters', async () => {
      const payload: AiVerificationPayloadDto = {
        idempotencyKey: 'd9e1b233-8083-4a25-8236-c69a997c306a',
        sessionId: 'session-123',
        stepId: 'step-456',
        status: VerificationStatus.COMPLETED,
        output: { verificationScore: 0.95 },
      };

      mockSessionService.submitToStep.mockResolvedValue({
        isIdempotent: false,
      });

      const result = await controller.handleAiVerification(payload);

      expect(sessionService.submitToStep).toHaveBeenCalledWith(
        payload.sessionId,
        payload.stepId,
        {
          submissionKey: payload.idempotencyKey,
          payload: payload.output,
        },
        payload.status,
      );

      expect(result).toEqual({ status: 'received', isIdempotent: false });
    });
  });
});
