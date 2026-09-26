import { ConfigService } from '@nestjs/config';
import { SendGridEmailAdapter } from './sendgrid-email.adapter';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('SendGridEmailAdapter', () => {
  const configMap: Record<string, string> = {
    SENDGRID_API_KEY: 'SG.test-api-key',
    SENDGRID_FROM_EMAIL: 'noreply@soter.test',
  };

  const mockConfig = {
    get: (key: string) => configMap[key],
  } as unknown as ConfigService;

  let adapter: SendGridEmailAdapter;

  beforeEach(() => {
    adapter = new SendGridEmailAdapter(mockConfig);
    mockFetch.mockReset();
  });

  it('should throw if SENDGRID_API_KEY is missing', () => {
    const badConfig = {
      get: () => undefined,
    } as unknown as ConfigService;

    expect(() => new SendGridEmailAdapter(badConfig)).toThrow(
      'SENDGRID_API_KEY is required',
    );
  });

  it('should throw if SENDGRID_FROM_EMAIL is missing', () => {
    const badConfig = {
      get: (key: string) => (key === 'SENDGRID_API_KEY' ? 'SG.key' : undefined),
    } as unknown as ConfigService;

    expect(() => new SendGridEmailAdapter(badConfig)).toThrow(
      'SENDGRID_FROM_EMAIL is required',
    );
  });

  it('should send email successfully and return providerMessageId', async () => {
    mockFetch.mockResolvedValue({
      status: 202,
      headers: new Map([['x-message-id', 'sg-msg-12345']]),
    });

    const result = await adapter.send({
      recipient: 'user@example.com',
      subject: 'Test Subject',
      message: 'Hello from Soter',
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('sg-msg-12345');

    // Verify fetch was called with correct params
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer SG.test-api-key',
          'Content-Type': 'application/json',
        }),
      }),
    );

    // Verify body shape
    const callArgs = mockFetch.mock.calls[0][1];
    const body = JSON.parse(callArgs.body);
    expect(body.personalizations[0].to[0].email).toBe('user@example.com');
    expect(body.personalizations[0].subject).toBe('Test Subject');
    expect(body.from.email).toBe('noreply@soter.test');
    expect(body.content[0].value).toBe('Hello from Soter');
  });

  it('should return failure on non-202 response', async () => {
    mockFetch.mockResolvedValue({
      status: 400,
      headers: new Map(),
      text: jest.fn().mockResolvedValue('Bad Request'),
    });

    const result = await adapter.send({
      recipient: 'bad@example.com',
      message: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 400');
  });

  it('should return failure on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network timeout'));

    const result = await adapter.send({
      recipient: 'user@example.com',
      message: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');
  });

  it('should use default subject when not provided', async () => {
    mockFetch.mockResolvedValue({
      status: 202,
      headers: new Map([['x-message-id', 'sg-msg-99']]),
    });

    await adapter.send({
      recipient: 'user@example.com',
      message: 'No subject test',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.personalizations[0].subject).toBe('Notification');
  });
});
