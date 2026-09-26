import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { HmacService } from '../hmac/hmac.service';
import { WebhookHmacGuard } from './webhook-hmac.guard';

const secret = 'test-hmac-secret-32-chars-long!!';

function createContext(signature: string, rawBody: Buffer): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-signature-256': signature },
        rawBody,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('WebhookHmacGuard', () => {
  let guard: WebhookHmacGuard;

  beforeEach(() => {
    const config = {
      getOrThrow: jest.fn().mockReturnValue(secret),
    } as unknown as ConfigService;
    guard = new WebhookHmacGuard(new HmacService(config));
  });

  it('accepts a valid X-Signature-256 HMAC', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        taskId: 'task-1',
        deliveryId: 'delivery-1',
        timestamp: '2024-03-24T10:30:00Z',
        status: 'completed',
      }),
    );
    const signature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    expect(guard.canActivate(createContext(signature, rawBody))).toBe(true);
  });

  it('rejects an invalid X-Signature-256 HMAC', () => {
    const rawBody = Buffer.from('{"taskId":"task-1"}');

    expect(() =>
      guard.canActivate(createContext('invalid-signature', rawBody)),
    ).toThrow(UnauthorizedException);
  });
});
