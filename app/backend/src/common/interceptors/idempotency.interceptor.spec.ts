import { ExecutionContext, UnprocessableEntityException } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { createHash } from 'crypto';
import { IdempotencyInterceptor } from './idempotency.interceptor';

const bodyHash = (body: object) =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex');

const makeContext = (
  method: string,
  body: object,
  idempotencyKey?: string,
): ExecutionContext => {
  const req = {
    method,
    body,
    headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : {},
  };
  const res = { status: jest.fn().mockReturnThis(), statusCode: 201 };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
};

const makeHandler = (value: unknown) => ({
  handle: () => of(value),
});

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let prisma: {
    idempotencyKey: {
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      idempotencyKey: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    interceptor = new IdempotencyInterceptor(prisma as any);
  });

  it('passes through non-POST requests without touching the DB', async () => {
    const ctx = makeContext('GET', {}, 'key-1');
    const obs = await interceptor.intercept(ctx, makeHandler('data'));
    await lastValueFrom(obs);
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it('passes through POST requests with no idempotency-key header', async () => {
    const ctx = makeContext('POST', { foo: 'bar' });
    const obs = await interceptor.intercept(ctx, makeHandler('data'));
    await lastValueFrom(obs);
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });

  it('stores the response on first POST with idempotency-key', async () => {
    const body = { amount: 100 };
    const ctx = makeContext('POST', body, 'idem-1');
    const obs = await interceptor.intercept(ctx, makeHandler({ id: 'new' }));
    await lastValueFrom(obs);
    expect(prisma.idempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'idem-1',
          bodyHash: bodyHash(body),
          response: { id: 'new' },
        }),
      }),
    );
  });

  it('replays the stored response on duplicate submission', async () => {
    const body = { amount: 100 };
    const stored = {
      key: 'idem-2',
      bodyHash: bodyHash(body),
      statusCode: 201,
      response: { id: 'existing' },
    };
    prisma.idempotencyKey.findUnique.mockResolvedValue(stored);

    const ctx = makeContext('POST', body, 'idem-2');
    const obs = await interceptor.intercept(ctx, makeHandler({ id: 'new' }));
    const result = await lastValueFrom(obs);

    expect(result).toEqual({ id: 'existing' });
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('throws 422 when idempotency-key is reused with a different body', async () => {
    const stored = {
      key: 'idem-3',
      bodyHash: bodyHash({ amount: 100 }),
      statusCode: 201,
      response: { id: 'existing' },
    };
    prisma.idempotencyKey.findUnique.mockResolvedValue(stored);

    const ctx = makeContext('POST', { amount: 999 }, 'idem-3');
    await expect(
      interceptor.intercept(ctx, makeHandler({ id: 'new' })),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('purges expired keys on each POST with idempotency-key', async () => {
    const ctx = makeContext('POST', {}, 'idem-4');
    const obs = await interceptor.intercept(ctx, makeHandler({}));
    await lastValueFrom(obs);
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});
