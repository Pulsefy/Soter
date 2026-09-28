import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom, Observable } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

const TTL_HOURS = 48;
const TTL_MS = TTL_HOURS * 60 * 60 * 1000;

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let prisma: {
    idempotencyKey: {
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
      create: jest.Mock;
    };
  };
  let configService: { get: jest.Mock };

  function makeContext(headers: Record<string, string>) {
    const request = { headers, statusCode: 200 } as never;
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      statusCode: 200,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { context, response, request };
  }

  const next: CallHandler = {
    handle: () => of({ ok: true }),
  };

  beforeEach(() => {
    prisma = {
      idempotencyKey: {
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      },
    };
    configService = { get: jest.fn().mockReturnValue(String(TTL_HOURS)) };

    interceptor = new IdempotencyInterceptor(
      prisma as unknown as PrismaService,
      configService as unknown as ConfigService,
    );
  });

  it('proceeds without touching the store when no key header is present', async () => {
    const { context } = makeContext({});
    const spy = jest.spyOn(next, 'handle');

    await interceptor.intercept(context, next);

    expect(spy).toHaveBeenCalled();
    expect(prisma.idempotencyKey.findFirst).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('replays the cached response for a valid (non-expired) key', async () => {
    const { context, response } = makeContext({
      'x-idempotency-key': 'key-1',
    });
    prisma.idempotencyKey.findFirst.mockResolvedValue({
      responseStatus: 200,
      responseBody: JSON.stringify({ hash: 'abc' }),
    });

    await interceptor.intercept(context, next);

    expect(prisma.idempotencyKey.findFirst).toHaveBeenCalledWith({
      where: {
        key: 'key-1',
        expiresAt: { gt: expect.any(Date) },
      },
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ hash: 'abc' });
    expect(prisma.idempotencyKey.deleteMany).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('treats fresh keys as absent and caches the response with an explicit expiry', async () => {
    const { context, response } = makeContext({
      'x-idempotency-key': 'key-2',
    });
    prisma.idempotencyKey.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 0 });

    const before = Date.now();
    const stream = await interceptor.intercept(context, next);
    const result = await lastValueFrom(stream);
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = Date.now();

    expect(result).toEqual({ ok: true });
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: {
        key: 'key-2',
        expiresAt: { lte: expect.any(Date) },
      },
    });

    expect(prisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.idempotencyKey.create.mock.calls[0][0] as {
      data: { expiresAt: Date };
    };
    expect(createArgs.data).toEqual(
      expect.objectContaining({ key: 'key-2', responseStatus: 200 }),
    );
    const expiry = createArgs.data.expiresAt.getTime();
    // Expiry = now + configured TTL (48h), within a small tolerance window
    expect(expiry).toBeGreaterThanOrEqual(before + TTL_MS - 1000);
    expect(expiry).toBeLessThanOrEqual(after + TTL_MS + 1000);

    void response;
  });

  it('treats expired-but-not-yet-purged keys as absent and reuses the key', async () => {
    const { context } = makeContext({ 'x-idempotency-key': 'key-expired' });
    prisma.idempotencyKey.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 1 });

    const stream = await interceptor.intercept(context, next);
    await lastValueFrom(stream);
    await new Promise(resolve => setTimeout(resolve, 0));

    // Stale row is cleared so the unique key can be reused
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: {
        key: 'key-expired',
        expiresAt: { lte: expect.any(Date) },
      },
    });
    // Request proceeds and a fresh record is created with a new expiry
    expect(prisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.idempotencyKey.create.mock.calls[0][0] as {
      data: { expiresAt: Date };
    };
    expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('only considers records that have not expired yet for replay', async () => {
    const { context, response } = makeContext({
      'x-idempotency-key': 'key-boundary',
    });
    // Record physically exists but its expiresAt is in the past
    prisma.idempotencyKey.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 1 });

    const stream = (await interceptor.intercept(
      context,
      next,
    )) as Observable<unknown>;
    await lastValueFrom(stream);
    await new Promise(resolve => setTimeout(resolve, 0));

    // The expired row was NOT replayed
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    // Lookup excluded expired rows and the stale row was cleared
    const findArgs = prisma.idempotencyKey.findFirst.mock.calls[0][0] as {
      where: { expiresAt: { gt: Date } };
    };
    expect(findArgs.where.expiresAt.gt).toBeInstanceOf(Date);
    const gt = findArgs.where.expiresAt.gt.getTime();
    const deleteArgs = prisma.idempotencyKey.deleteMany.mock.calls[0][0] as {
      where: { expiresAt: { lte: Date } };
    };
    expect(deleteArgs.where.expiresAt.lte.getTime()).toBeGreaterThanOrEqual(gt);
  });

  it('does not fail the request when caching fails', async () => {
    const { context } = makeContext({ 'x-idempotency-key': 'key-3' });
    prisma.idempotencyKey.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 0 });
    prisma.idempotencyKey.create.mockRejectedValue(
      new Error('unique constraint violation'),
    );

    const stream = await interceptor.intercept(context, next);
    await expect(lastValueFrom(stream)).resolves.toEqual({ ok: true });
  });

  it('derives the expiry from the configured retention window', async () => {
    configService.get.mockReturnValue('1'); // 1 hour TTL

    const { context } = makeContext({ 'x-idempotency-key': 'key-ttl' });
    prisma.idempotencyKey.findFirst.mockResolvedValue(null);
    prisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 0 });

    const stream = await interceptor.intercept(context, next);
    await lastValueFrom(stream);
    await new Promise(resolve => setTimeout(resolve, 0));

    const createArgs = prisma.idempotencyKey.create.mock.calls[0][0] as {
      data: { expiresAt: Date };
    };
    const expiryMs = createArgs.data.expiresAt.getTime();
    const nowMs = Date.now();
    expect(expiryMs).toBeGreaterThanOrEqual(nowMs - 1000);
    expect(expiryMs).toBeLessThanOrEqual(nowMs + 3600_000 + 1000);
    expect(expiryMs).toBeLessThan(nowMs + 3600_000 * 2);
  });
});
