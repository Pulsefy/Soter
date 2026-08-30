import { ConfigService } from '@nestjs/config';
import { TwilioSmsAdapter } from './twilio-sms.adapter';

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('TwilioSmsAdapter', () => {
  const configMap: Record<string, string> = {
    TWILIO_ACCOUNT_SID: 'AC_test_sid',
    TWILIO_AUTH_TOKEN: 'test_auth_token',
    TWILIO_FROM_NUMBER: '+15551234567',
  };

  const mockConfig = {
    get: (key: string) => configMap[key],
  } as unknown as ConfigService;

  let adapter: TwilioSmsAdapter;

  beforeEach(() => {
    adapter = new TwilioSmsAdapter(mockConfig);
    mockFetch.mockReset();
  });

  it('should throw if TWILIO_ACCOUNT_SID is missing', () => {
    const badConfig = {
      get: () => undefined,
    } as unknown as ConfigService;

    expect(() => new TwilioSmsAdapter(badConfig)).toThrow(
      'TWILIO_ACCOUNT_SID is required',
    );
  });

  it('should throw if TWILIO_AUTH_TOKEN is missing', () => {
    const badConfig = {
      get: (key: string) =>
        key === 'TWILIO_ACCOUNT_SID' ? 'AC_sid' : undefined,
    } as unknown as ConfigService;

    expect(() => new TwilioSmsAdapter(badConfig)).toThrow(
      'TWILIO_AUTH_TOKEN is required',
    );
  });

  it('should throw if TWILIO_FROM_NUMBER is missing', () => {
    const badConfig = {
      get: (key: string) => {
        if (key === 'TWILIO_ACCOUNT_SID') return 'AC_sid';
        if (key === 'TWILIO_AUTH_TOKEN') return 'token';
        return undefined;
      },
    } as unknown as ConfigService;

    expect(() => new TwilioSmsAdapter(badConfig)).toThrow(
      'TWILIO_FROM_NUMBER is required',
    );
  });

  it('should send SMS successfully and return providerMessageId (SID)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ sid: 'SM_test_message_sid' }),
    });

    const result = await adapter.send({
      recipient: '+15559876543',
      message: 'Your code is 1234',
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('SM_test_message_sid');

    // Verify fetch was called with correct URL
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );

    // Verify Authorization header (Basic auth)
    const callHeaders = mockFetch.mock.calls[0][1].headers;
    const decoded = Buffer.from(
      callHeaders.Authorization.replace('Basic ', ''),
      'base64',
    ).toString();
    expect(decoded).toBe('AC_test_sid:test_auth_token');

    // Verify body params
    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get('To')).toBe('+15559876543');
    expect(body.get('From')).toBe('+15551234567');
    expect(body.get('Body')).toBe('Your code is 1234');
  });

  it('should return failure on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue('Invalid number'),
    });

    const result = await adapter.send({
      recipient: 'invalid',
      message: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 400');
  });

  it('should return failure on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const result = await adapter.send({
      recipient: '+15559876543',
      message: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});
