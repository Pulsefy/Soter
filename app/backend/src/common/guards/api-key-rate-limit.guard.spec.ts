import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeyRateLimitGuard } from './api-key-rate-limit.guard';
import { ApiKeyScope } from '../../api-keys/api-key-scope.enum';
import { MetricsService } from '../../observability/metrics/metrics.service';

describe('ApiKeyRateLimitGuard', () => {
  let guard: ApiKeyRateLimitGuard;
  let redisMock: {
    incr: jest.Mock;
    expire: jest.Mock;
    ttl: jest.Mock;
  };
  let configMock: { get: jest.Mock };
  let reflectorMock: { getAllAndOverride: jest.Mock };
  let metricsMock: { incrementApiKeyRateLimitRejection: jest.Mock };

  const makeContext = (user?: Record<string, unknown>): ExecutionContext => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: jest.fn(),
    };
    const req = {
      user,
      headers,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    redisMock = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(60),
    };
    configMock = {
      get: jest.fn().mockReturnValue(undefined),
    };
    reflectorMock = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    metricsMock = {
      incrementApiKeyRateLimitRejection: jest.fn(),
    };

    guard = new ApiKeyRateLimitGuard(
      redisMock as any,
      configMock as unknown as ConfigService,
      reflectorMock as unknown as Reflector,
      metricsMock as unknown as MetricsService,
    );
  });

  it('should pass through for requests without an API key', async () => {
    const ctx = makeContext(undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it('should pass through for JWT-authenticated requests', async () => {
    const ctx = makeContext({ id: 'user-1', authType: 'jwt' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it('should pass through when @Public() is set', async () => {
    reflectorMock.getAllAndOverride.mockReturnValueOnce(true);
    const ctx = makeContext({
      apiKeyId: 'key-1',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read],
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it('should allow requests within the limit', async () => {
    redisMock.incr.mockResolvedValue(5); // well within default 200 for read
    const ctx = makeContext({
      apiKeyId: 'key-1',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read],
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    // Verify rate-limit headers were set
    const res = ctx.switchToHttp().getResponse();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 200);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 195);
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-RateLimit-Reset',
      expect.any(Number),
    );
  });

  it('should reject with 429 when limit is exceeded', async () => {
    redisMock.incr.mockResolvedValue(201); // exceeds default 200 for read
    redisMock.ttl.mockResolvedValue(30);

    const ctx = makeContext({
      apiKeyId: 'key-1',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read],
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      const body = (e as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.code).toBe('API_KEY_RATE_LIMIT_EXCEEDED');
      expect(body.limit).toBe(200);
      expect(body.retryAfter).toBe(30);
    }
  });

  it('should isolate limits between different API keys', async () => {
    // Key A: at its limit
    redisMock.incr.mockResolvedValue(200);
    const ctxA = makeContext({
      apiKeyId: 'key-A',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read],
    });
    await expect(guard.canActivate(ctxA)).resolves.toBe(true);

    // Key B: fresh counter
    redisMock.incr.mockResolvedValue(1);
    const ctxB = makeContext({
      apiKeyId: 'key-B',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read],
    });
    await expect(guard.canActivate(ctxB)).resolves.toBe(true);

    // Verify they use different Redis keys
    expect(redisMock.incr).toHaveBeenCalledWith('ratelimit:perkey:key-A');
    expect(redisMock.incr).toHaveBeenCalledWith('ratelimit:perkey:key-B');
  });

  it('should use the most restrictive scope limit', async () => {
    // Key has both read (200) and write (100) scopes → effective limit is 100
    redisMock.incr.mockResolvedValue(101);
    redisMock.ttl.mockResolvedValue(45);

    const ctx = makeContext({
      apiKeyId: 'key-multi',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read, ApiKeyScope.write],
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (e) {
      const body = (e as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.limit).toBe(100); // write limit, the more restrictive
    }
  });

  it('should set Retry-After header on rejection', async () => {
    redisMock.incr.mockResolvedValue(301);
    redisMock.ttl.mockResolvedValue(25);

    const ctx = makeContext({
      apiKeyId: 'key-1',
      authType: 'apiKey',
      scopes: [ApiKeyScope.admin],
    });

    try {
      await guard.canActivate(ctx);
    } catch {
      // Expected
    }

    const res = ctx.switchToHttp().getResponse();
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 25);
  });

  it('should increment metric on rejection', async () => {
    redisMock.incr.mockResolvedValue(201);
    redisMock.ttl.mockResolvedValue(30);

    const ctx = makeContext({
      apiKeyId: 'key-metric',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read],
    });

    try {
      await guard.canActivate(ctx);
    } catch {
      // Expected
    }

    expect(metricsMock.incrementApiKeyRateLimitRejection).toHaveBeenCalledWith(
      'read',
      'key-metric',
    );
  });

  it('should set expire only on first increment', async () => {
    // First request for this key
    redisMock.incr.mockResolvedValue(1);

    const ctx = makeContext({
      apiKeyId: 'key-new',
      authType: 'apiKey',
      scopes: [ApiKeyScope.read],
    });

    await guard.canActivate(ctx);
    expect(redisMock.expire).toHaveBeenCalledWith(
      'ratelimit:perkey:key-new',
      60,
    );

    // Subsequent request
    redisMock.incr.mockResolvedValue(2);
    redisMock.expire.mockClear();

    await guard.canActivate(ctx);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it('should respect per-scope env overrides', () => {
    configMock.get.mockImplementation((key: string) => {
      if (key === 'RATE_LIMIT_SCOPE_READ_LIMIT') return '50';
      if (key === 'RATE_LIMIT_SCOPE_READ_WINDOW') return '30';
      return undefined;
    });

    // Re-create guard with the new config
    guard = new ApiKeyRateLimitGuard(
      redisMock as any,
      configMock as unknown as ConfigService,
      reflectorMock as unknown as Reflector,
      metricsMock as unknown as MetricsService,
    );

    // Access the private method via any cast to verify config parsing
    const resolved = (guard as any).resolveLimit([ApiKeyScope.read]);
    expect(resolved.limit).toBe(50);
    expect(resolved.window).toBe(30);
  });
});
