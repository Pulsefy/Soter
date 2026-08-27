import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SendGridEmailAdapter } from './sendgrid-email.adapter';
import axios from 'axios';
import { NotificationType } from '../interfaces/notification-job.interface';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SendGridEmailAdapter', () => {
  let adapter: SendGridEmailAdapter;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendGridEmailAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                SENDGRID_API_KEY: 'test-api-key',
                SENDGRID_FROM_EMAIL: 'test@example.com',
                SENDGRID_FROM_NAME: 'Test Sender',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    adapter = module.get<SendGridEmailAdapter>(SendGridEmailAdapter);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getType', () => {
    it('should return EMAIL notification type', () => {
      expect(adapter.getType()).toBe(NotificationType.EMAIL);
    });
  });

  describe('sendEmail', () => {
    it('should send email successfully via SendGrid', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 202,
        headers: { 'x-message-id': 'sendgrid-msg-123' },
        data: {},
      });

      const result = await adapter.sendEmail({
        recipient: 'recipient@example.com',
        subject: 'Test Subject',
        message: 'Test message body',
      });

      expect(result.success).toBe(true);
      expect(result.providerMessageId).toBe('sendgrid-msg-123');
      expect(result.metadata?.provider).toBe('sendgrid');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.objectContaining({
          personalizations: [
            {
              to: [{ email: 'recipient@example.com' }],
              subject: 'Test Subject',
            },
          ],
          from: {
            email: 'test@example.com',
            name: 'Test Sender',
          },
          content: [
            {
              type: 'text/plain',
              value: 'Test message body',
            },
          ],
        }),
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
        }),
      );
    });

    it('should send HTML email when html is provided', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 202,
        headers: { 'x-message-id': 'sendgrid-msg-456' },
        data: {},
      });

      const result = await adapter.sendEmail({
        recipient: 'recipient@example.com',
        subject: 'Test Subject',
        message: 'Test message body',
        html: '<p>Test HTML body</p>',
      });

      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          content: [
            {
              type: 'text/html',
              value: '<p>Test HTML body</p>',
            },
          ],
        }),
        expect.any(Object),
      );
    });

    it('should return failure when SendGrid is not configured', async () => {
      const unconfiguredAdapter = new SendGridEmailAdapter({
        get: jest.fn().mockReturnValue(''),
      } as any);

      const result = await unconfiguredAdapter.sendEmail({
        recipient: 'recipient@example.com',
        subject: 'Test',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SendGrid not configured');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should handle SendGrid API errors', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          status: 400,
          data: { errors: [{ message: 'Invalid email address' }] },
        },
        message: 'Request failed',
      });

      const result = await adapter.sendEmail({
        recipient: 'invalid-email',
        subject: 'Test',
        message: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('SendGrid error');
      expect(result.metadata?.statusCode).toBe(400);
    });
  });

  describe('sendSms', () => {
    it('should return error for SMS requests', async () => {
      const result = await adapter.sendSms({
        recipient: '+1234567890',
        message: 'Test SMS',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support SMS');
    });
  });
});
