import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeliveryAdapterFactory } from './delivery-adapter.factory';
import { MockDeliveryAdapter } from './mock-delivery.adapter';
import { SendGridEmailAdapter } from './sendgrid-email.adapter';
import { TwilioSmsAdapter } from './twilio-sms.adapter';
import { NotificationType } from '../interfaces/notification-job.interface';

describe('DeliveryAdapterFactory', () => {
  let factory: DeliveryAdapterFactory;
  let mockAdapter: MockDeliveryAdapter;
  let emailAdapter: SendGridEmailAdapter;
  let smsAdapter: TwilioSmsAdapter;

  describe('mock mode', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeliveryAdapterFactory,
          MockDeliveryAdapter,
          SendGridEmailAdapter,
          TwilioSmsAdapter,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'NOTIFICATION_DELIVERY_MODE') return 'mock';
                return '';
              }),
            },
          },
        ],
      }).compile();

      factory = module.get<DeliveryAdapterFactory>(DeliveryAdapterFactory);
      mockAdapter = module.get<MockDeliveryAdapter>(MockDeliveryAdapter);
    });

    it('should return mock adapter for email in mock mode', () => {
      const adapter = factory.getAdapter(NotificationType.EMAIL);
      expect(adapter).toBe(mockAdapter);
    });

    it('should return mock adapter for SMS in mock mode', () => {
      const adapter = factory.getAdapter(NotificationType.SMS);
      expect(adapter).toBe(mockAdapter);
    });
  });

  describe('real mode with full configuration', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeliveryAdapterFactory,
          MockDeliveryAdapter,
          SendGridEmailAdapter,
          TwilioSmsAdapter,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, string> = {
                  NOTIFICATION_DELIVERY_MODE: 'real',
                  SENDGRID_API_KEY: 'test-sendgrid-key',
                  SENDGRID_FROM_EMAIL: 'test@example.com',
                  TWILIO_ACCOUNT_SID: 'test-twilio-sid',
                  TWILIO_AUTH_TOKEN: 'test-twilio-token',
                  TWILIO_FROM_PHONE: '+15551234567',
                };
                return config[key];
              }),
            },
          },
        ],
      }).compile();

      factory = module.get<DeliveryAdapterFactory>(DeliveryAdapterFactory);
      emailAdapter = module.get<SendGridEmailAdapter>(SendGridEmailAdapter);
      smsAdapter = module.get<TwilioSmsAdapter>(TwilioSmsAdapter);
    });

    it('should return SendGrid adapter for email when configured', () => {
      const adapter = factory.getAdapter(NotificationType.EMAIL);
      expect(adapter).toBe(emailAdapter);
    });

    it('should return Twilio adapter for SMS when configured', () => {
      const adapter = factory.getAdapter(NotificationType.SMS);
      expect(adapter).toBe(smsAdapter);
    });
  });

  describe('real mode with partial configuration', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeliveryAdapterFactory,
          MockDeliveryAdapter,
          SendGridEmailAdapter,
          TwilioSmsAdapter,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, string> = {
                  NOTIFICATION_DELIVERY_MODE: 'real',
                  SENDGRID_API_KEY: 'test-sendgrid-key',
                  SENDGRID_FROM_EMAIL: 'test@example.com',
                  // Twilio not configured
                };
                return config[key] || '';
              }),
            },
          },
        ],
      }).compile();

      factory = module.get<DeliveryAdapterFactory>(DeliveryAdapterFactory);
      mockAdapter = module.get<MockDeliveryAdapter>(MockDeliveryAdapter);
      emailAdapter = module.get<SendGridEmailAdapter>(SendGridEmailAdapter);
    });

    it('should return SendGrid adapter for email when configured', () => {
      const adapter = factory.getAdapter(NotificationType.EMAIL);
      expect(adapter).toBe(emailAdapter);
    });

    it('should fall back to mock adapter for SMS when Twilio not configured', () => {
      const adapter = factory.getAdapter(NotificationType.SMS);
      expect(adapter).toBe(mockAdapter);
    });
  });

  describe('real mode with no configuration', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeliveryAdapterFactory,
          MockDeliveryAdapter,
          SendGridEmailAdapter,
          TwilioSmsAdapter,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'NOTIFICATION_DELIVERY_MODE') return 'real';
                return '';
              }),
            },
          },
        ],
      }).compile();

      factory = module.get<DeliveryAdapterFactory>(DeliveryAdapterFactory);
      mockAdapter = module.get<MockDeliveryAdapter>(MockDeliveryAdapter);
    });

    it('should fall back to mock adapter for email when SendGrid not configured', () => {
      const adapter = factory.getAdapter(NotificationType.EMAIL);
      expect(adapter).toBe(mockAdapter);
    });

    it('should fall back to mock adapter for SMS when Twilio not configured', () => {
      const adapter = factory.getAdapter(NotificationType.SMS);
      expect(adapter).toBe(mockAdapter);
    });
  });
});
