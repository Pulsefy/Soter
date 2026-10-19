/**
 * HTTP-level tests for POST /webhooks/ai-verification using the real
 * HMAC guard, real exception filter and the production-style global
 * ValidationPipe: authenticity (401) is checked before shape (400).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AidService } from './aid/aid.service';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { WebhookHmacGuard } from './common/guards/webhook-hmac.guard';
import { HmacService } from './common/hmac/hmac.service';
import { LoggerService } from './logger/logger.service';
import { WebhooksController } from './webhooks.controller';

describe('POST /webhooks/ai-verification validation', () => {
  const SECRET = 'test-webhook-secret';
  const URL = '/webhooks/ai-verification';
  let app: INestApplication;
  let hmac: HmacService;
  const handleTaskWebhook = jest.fn();

  const valid = {
    taskId: 'task-1',
    deliveryId: 'delivery-1',
    timestamp: '2024-03-24T10:30:00Z',
    status: 'completed',
    result: { prediction: 'approved', confidence: 0.95 },
  };

  const post = (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    const req = request(app.getHttpServer())
      .post(URL)
      .set('Content-Type', 'application/json');
    if (signature !== 'none')
      req.set('X-Signature-256', signature ?? hmac.sign(raw));
    return req.send(raw);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        WebhookHmacGuard,
        HmacService,
        { provide: AidService, useValue: { handleTaskWebhook } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => SECRET },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: 422,
      }),
    );
    app.useGlobalFilters(
      new AllExceptionsFilter({ error: jest.fn() } as unknown as LoggerService),
    );
    await app.init();
    hmac = moduleRef.get(HmacService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handleTaskWebhook.mockReset();
    handleTaskWebhook.mockResolvedValue({ received: true });
  });

  it('accepts a validly signed, well-formed payload', async () => {
    const res = await post(valid);

    expect(res.status).toBe(200);
    expect(handleTaskWebhook).toHaveBeenCalledTimes(1);
    expect(handleTaskWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', status: 'completed' }),
    );
  });

  it.each([
    ['a required field is missing', { ...valid, taskId: undefined }, 'taskId'],
    ['status is not a known value', { ...valid, status: 'exploded' }, 'status'],
    [
      'timestamp is not a date string',
      { ...valid, timestamp: 'yesterday' },
      'timestamp',
    ],
    [
      'a failed task has no error message',
      { ...valid, status: 'failed', result: undefined },
      'error',
    ],
    [
      'an unexpected property is present',
      { ...valid, injected: 'x' },
      'injected',
    ],
  ])(
    'rejects a validly signed but malformed payload with 400 (%s)',
    async (_label, body, field) => {
      const res = await post(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(400);
      expect(res.body.errorCode).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('Invalid request body');
      expect(res.body.message).toContain(field);
      expect(handleTaskWebhook).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-object body with 400', async () => {
    const res = await post([valid]);

    expect(res.status).toBe(400);
    expect(handleTaskWebhook).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature with 401', async () => {
    const res = await post(valid, 'deadbeef');

    expect(res.status).toBe(401);
    expect(handleTaskWebhook).not.toHaveBeenCalled();
  });

  it('rejects a missing signature with 401', async () => {
    const res = await post(valid, 'none');

    expect(res.status).toBe(401);
    expect(handleTaskWebhook).not.toHaveBeenCalled();
  });

  it('checks the signature before the shape: bad signature + bad body is 401, not 400', async () => {
    const res = await post({ nonsense: true }, 'deadbeef');

    expect(res.status).toBe(401);
    expect(handleTaskWebhook).not.toHaveBeenCalled();
  });
});
