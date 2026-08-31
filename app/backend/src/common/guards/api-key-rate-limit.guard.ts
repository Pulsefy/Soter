import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { Request, Response } from 'express';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { ApiKeyScope } from '../../api-keys/api-key-scope.enum';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_THROTTLE_KEY } from '../decorators/skip-throttle.decorator';
import { MetricsService } from '../../observability/metrics/metrics.service';

interface RateLimitUser {
  apiKeyId?: string;
  authType?: 'apiKey' | 'envApiKey' | 'jwt' | 'wallet';
  scopes?: ApiKeyScope[];
  role?: string;
}

/**
 * Per-scope default rate limits (requests per window).
 * Overridable via env vars RATE_LIMIT_SCOPE_<SCOPE>_LIMIT / _WINDOW.
 */
const DEFAULT_SCOPE_LIMITS: Record<
  ApiKeyScope,
  { limit: number; window: number }
> = {
  [ApiKeyScope.read]: { limit: 200, window: 60 },
  [ApiKeyScope.write]: { limit: 100, window: 60 },
  [ApiKeyScope.admin]: { limit: 300, window: 60 },
  [ApiKeyScope.webhook]: { limit: 500, window: 60 },
};

/**
 * Rate-limits requests per API key (issue #952).
 *
 * Runs *after* ApiKeyGuard / ScopesGuard have populated `request.user`.
 * For each API-key-authenticated request the guard increments a Redis
 * counter keyed by `ratelimit:perkey:<apiKeyId>` and applies the most
 * restrictive limit across the key's scopes.
 *
 * Non-API-key requests (public, JWT, wallet) pass through untouched —
 * those are handled by the existing AdaptiveRateLimitGuard.
 */
@Injectable()
export class ApiKeyRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyRateLimitGuard.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly metricsService: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Respect @Public() and @SkipThrottle() decorators
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skipThrottle = this.reflector.getAllAndOverride<boolean>(
      SKIP_THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipThrottle) return true;

    const request: Request = context.switchToHttp().getRequest<Request>();
    const user = request.user as RateLimitUser | undefined;

    // Only act on API-key-authenticated requests
    if (
      !user?.apiKeyId ||
      (user.authType !== 'apiKey' && user.authType !== 'envApiKey')
    ) {
      return true;
    }

    const scopes: ApiKeyScope[] = user.scopes ?? [ApiKeyScope.admin];
    const { limit, window: windowSec } = this.resolveLimit(scopes);

    const key = `ratelimit:perkey:${user.apiKeyId}`;
    const now = Date.now();

    // Sliding window counter via Redis MULTI: INCR + conditional EXPIRE
    const current = await this.redis.incr(key);
    if (current === 1) {
      await this.redis.expire(key, windowSec);
    }

    const ttl = await this.redis.ttl(key);
    const resetAt = Math.ceil(now / 1000) + (ttl > 0 ? ttl : windowSec);
    const remaining = Math.max(0, limit - current);

    const response: Response = context.switchToHttp().getResponse<Response>();

    // Always set informational headers
    response.setHeader('X-RateLimit-Limit', limit);
    response.setHeader('X-RateLimit-Remaining', remaining);
    response.setHeader('X-RateLimit-Reset', resetAt);

    if (current > limit) {
      const retryAfter = ttl > 0 ? ttl : 1;
      response.setHeader('Retry-After', retryAfter);

      // Metric — use the most restrictive scope as label
      const scopeLabel = this.mostRestrictiveScope(scopes);
      this.metricsService.incrementApiKeyRateLimitRejection(
        scopeLabel,
        user.apiKeyId,
      );

      this.logger.warn(
        `API key ${user.apiKeyId} exceeded per-key rate limit ` +
          `(${current}/${limit} in ${windowSec}s window, scope=${scopeLabel})`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'API key rate limit exceeded. Please try again later.',
          code: 'API_KEY_RATE_LIMIT_EXCEEDED',
          limit,
          remaining: 0,
          retryAfter,
          resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Resolve the effective rate limit for a set of scopes.
   * Takes the *most restrictive* (lowest) limit across all scopes the key holds.
   */
  private resolveLimit(scopes: ApiKeyScope[]): {
    limit: number;
    window: number;
  } {
    let minLimit = Infinity;
    let associatedWindow = 60;

    for (const scope of scopes) {
      const { limit, window: win } = this.getScopeLimitConfig(scope);
      if (limit < minLimit) {
        minLimit = limit;
        associatedWindow = win;
      }
    }

    // Fallback if scopes array is empty (shouldn't happen)
    if (!Number.isFinite(minLimit)) {
      return { limit: 100, window: 60 };
    }

    return { limit: minLimit, window: associatedWindow };
  }

  private getScopeLimitConfig(scope: ApiKeyScope): {
    limit: number;
    window: number;
  } {
    const envPrefix = `RATE_LIMIT_SCOPE_${scope.toUpperCase()}`;

    const limitRaw = this.config.get<string>(`${envPrefix}_LIMIT`);
    const windowRaw = this.config.get<string>(`${envPrefix}_WINDOW`);

    const defaults = DEFAULT_SCOPE_LIMITS[scope] ?? { limit: 100, window: 60 };

    const limit = this.parsePositive(limitRaw, defaults.limit);
    const window = this.parsePositive(windowRaw, defaults.window);

    return { limit, window };
  }

  private mostRestrictiveScope(scopes: ApiKeyScope[]): string {
    if (scopes.length === 0) return 'unknown';
    let min = scopes[0];
    let minLimit = this.getScopeLimitConfig(scopes[0]).limit;
    for (let i = 1; i < scopes.length; i++) {
      const l = this.getScopeLimitConfig(scopes[i]).limit;
      if (l < minLimit) {
        minLimit = l;
        min = scopes[i];
      }
    }
    return min;
  }

  private parsePositive(raw: string | undefined, fallback: number): number {
    if (raw == null) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
