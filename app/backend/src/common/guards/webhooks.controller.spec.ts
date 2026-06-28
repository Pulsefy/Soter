import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from 'src/audit/webhook.controller';
import { SessionService } from 'src/session/session.service';
import { WebhooksService } from 'src/audit/webhooks.service'; // Adjust path path if needed
import { ConfigModule } from '@nestjs/config';
import appConfig from '../../config/config';

describe('WebhookController', () => {
  let controller: WebhookController;

  const mockSessionService = {
    submitToStep: jest.fn(),
  };

  const mockWebhooksService = {
    handleAiVerification: jest
      .fn()
      .mockResolvedValue({ status: 'received', isIdempotent: false }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ load: [appConfig] })],
      controllers: [WebhookController],
      providers: [
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
        {
          provide: WebhooksService,
          useValue: mockWebhooksService, // Injected to clear dependency loader errors
        },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
