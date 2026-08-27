import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwilioSmsAdapter } from './twilio-sms.adapter';
import axios from 'axios';
import { NotificationType } from '../interfaces/notification-job.interface';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TwilioSmsAdapter', () => {
  let adapter: TwilioSmsAdapter;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwilioSmsAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                TWILIO_ACCOUNT_SID: 'test-account-sid',
                TWILIO_AUTH_TOKEN: 'test-auth-token',
                TWILIO_FROM_PHONE: '+15551234567',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    adapter = module.get<TwilioSmsAdapter>(TwilioSmsAdapter);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getType', () => {
    it('should return SMS notification type', () => {
      expect(adapter.getType()).toBe(NotificationType.SMS);
    });
  });

  describe('sendSms', () => {
    it('should send SMS successfully via Twilio', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: {
          sid: 'SM1234567890abcdef',
          status: 'queued',
        },
      });

      const result = await adapter.sendSms({
        recipient: '+15559876543',
        message: 'Test SMS message',
      });

      expect(result.success).toBe(true);
      expect(result.providerMessageId).toBe('SM1234567890abcdef');
      expect(result.metadata?.provider).toBe('twilio');
      expect(result.metadata?.status).toBe('queued');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.twilio.com/2010-04-01/Accounts/test-account-sid/Messages.json',
        expect.stringContaining('To=%2B15559876543'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          auth: {
            username: 'test-account-sid',
            password: 'test-auth-token',
          },
        }),
      );
    });

    it('should use custom from phone when provided', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 201,
        data: { sid: 'SM123', status: 'queued' },
      });

      await adapter.sendSms({
        recipient: '+15559876543',
        message: 'Test',
        from: '+15551111111',
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('From=%2B15551111111'),
        expect.any(Object),
      );
    });

    it('should return failure when Twilio is not configured', async () => {
      const unconfiguredAdapter = new TwilioSmsAdapter({
        get: jest.fn().mockReturnValue(''),
      } as any);

      const result = await unconfiguredAdapter.sendSms({
        recipient: '+15559876543',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Twilio not configured');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should handle Twilio API errors', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            message: 'Invalid phone number',
            code: 21211,
          },
        },
        message: 'Request failed',
      });

      const result = await adapter.sendSms({
        recipient: 'invalid-phone',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phone number');
      expect(result.metadata?.statusCode).toBe(400);
      expect(result.metadata?.errorCode).toBe(21211);
    });
  });

  describe('sendEmail', () => {
    it('should return error for email requests', async () => {
      const result = await adapter.sendEmail({
        recipient: 'test@example.com',
        subject: 'Test',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support email');
    });
  });
});
