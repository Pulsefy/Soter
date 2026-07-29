import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import rateLimitConfig from '../../config/rate-limit.config';
import { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { Request } from 'express';
import { REDIS_CLIENT } from '../../redis/redis.module';
import rateLimitConfig from '../../config/rate-limit.config';
import {
  RateLimitConfig,
  RateLimitPolicy,
  getRateLimitPolicy,
} from '../../config/rate-limit.config';

interface RateLimitUser {
  id?: string;
  apiKeyId?: string;
  authType?: 'apiKey' | 'envApiKey' | 'jwt' | 'wallet';
  role?: string;
}

@Injectable()
export class AdaptiveRateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    @Inject(rateLimitConfig.KEY)
    private readonly config: ConfigType<typeof rateLimitConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest<Request>();
    const client = this.redisClient;

    const user = request.user as RateLimitUser | undefined;
    const userType = this.getUserType(user);
    const policy = this.getPolicyForRequest(request, userType);

    let client;
    try {
      if (!this.redisClient) {
        throw new Error('Redis client not available');
      }
      client = this.redisClient;
    } catch (redisError) {
      return true;
    }

    try {
      const user = request.user as RateLimitUser | undefined;
      const userType = this.getUserType(user);
      const policy = this.getPolicyForRequest(request, userType);

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

      const response = context.switchToHttp().getResponse();
      response.setHeader('X-RateLimit-Limit', limit);
      response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
      response.setHeader('X-RateLimit-Policy', keyPrefix || userType);

      return true;
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      return true;
    }
  }

  private getUserType(
    user?: RateLimitUser,
  ): 'public' | 'auth' | 'apiKey' | 'admin' {
    if (!user) {
      return 'public';
    }

    if (user.role === 'admin' || user.role === 'super_admin') {
      return 'admin';
    }

    if (user.authType === 'apiKey' || user.authType === 'envApiKey') {
      return 'apiKey';
    }

    if (user.id || user.authType === 'jwt' || user.authType === 'wallet') {
      return 'auth';
    }

    return 'public';
  }

  private getPolicyForRequest(
    request: Request,
    userType: 'public' | 'auth' | 'apiKey' | 'admin',
  ): RateLimitPolicy {
    const path = request.path || request.url || '';

    if (path.includes('/search')) {
      const searchPolicy = this.config.search;
      if (searchPolicy) {
        return searchPolicy;
      }
      return { limit: 30, window: 60, keyPrefix: 'search', enabled: true };
    }

    return getRateLimitPolicy(this.config, path, userType);
  }

  private getIdentifier(request: Request, user?: RateLimitUser): string {
    if (user?.id) {
      return `user:${user.id}`;
    }

    if (user?.apiKeyId) {
      return `apikey:${user.apiKeyId}`;
    }

    const forwardedIp = request.headers['x-forwarded-for'] as
      | string
      | undefined;
    if (forwardedIp) {
      const ips = forwardedIp.split(',').map(ip => ip.trim());
      if (ips.length > 0 && ips[0]) {
        return `ip:${ips[0]}`;
      }
    }

    if (request.ips && request.ips.length > 0) {
      return `ip:${request.ips[0]}`;
    }

    if (request.ip) {
      return `ip:${request.ip}`;
    }

    return 'ip:anonymous';
  }
}
