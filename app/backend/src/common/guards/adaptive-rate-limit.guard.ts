import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Request } from 'express';
import type { Redis } from 'ioredis';

interface RateLimitedUser {
  id?: string;
  apiKeyId?: string;
  authType?: 'apiKey' | 'envApiKey';
}

type RateLimitedRequest = Request & {
  path?: string;
  url?: string;
  ip?: string;
  ips?: string[];
  user?: RateLimitedUser;
};

type RateLimitStrategy = 'auth' | 'search' | 'public' | 'apiKey';
type RateLimitConfig = Record<
  RateLimitStrategy,
  { limit: number; window: number }
>;

interface RateLimitUser {
  id?: string;
  apiKeyId?: string;
  authType?: 'apiKey' | 'envApiKey' | 'jwt' | 'wallet';
  role?: string;
}

@Injectable()
export class AdaptiveRateLimitGuard implements CanActivate {
  private readonly limits: RateLimitConfig = {
    auth: { limit: 5, window: 60 },
    search: { limit: 30, window: 60 },
    public: { limit: 10, window: 60 },
    apiKey: { limit: 100, window: 60 },
  };

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const client: Redis = this.redisService.getOrThrow();

    const user = request.user as RateLimitUser | undefined;
    const userType = this.getUserType(user);
    const policy = this.getPolicyForRequest(request, userType);

    // Skip rate limiting if disabled
    if (policy.enabled === false) {
      return true;
    }

    const { limit, window, keyPrefix } = policy;
    const identifier = this.getIdentifier(request, user);
    const key = `ratelimit:${keyPrefix || userType}:${identifier}`;

    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, window);
    }

    if (current > limit) {
      const ttl = await client.ttl(key);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests, please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          limit,
          window,
          retryAfter: ttl > 0 ? ttl : 1,
          resetIn: ttl,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Add rate limit headers
    const response = context.switchToHttp().getResponse();
    response.setHeader('X-RateLimit-Limit', limit);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
    response.setHeader('X-RateLimit-Policy', keyPrefix || userType);

    return true;
  }

  private getStrategy(request: RateLimitedRequest): RateLimitStrategy {
    const path = request.path ?? request.url ?? '';
    if (path.includes('/search')) return 'search';

    // API key users
    if (user.authType === 'apiKey' || user.authType === 'envApiKey') {
      return 'apiKey';
    }

    // Authenticated users
    if (user.id || user.authType === 'jwt' || user.authType === 'wallet') {
      return 'auth';
    }

    return 'public';
  }

  private getIdentifier(request: RateLimitedRequest): string {
    const user = request.user;
    if (user?.id) return user.id;
    if (user?.apiKeyId) return user.apiKeyId;

    // Ultimate fallback
    return 'ip:anonymous';
  }
}
