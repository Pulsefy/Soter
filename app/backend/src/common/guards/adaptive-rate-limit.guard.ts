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
import rateLimitConfig from '../../config/rate-limit.config';
import {
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
    private readonly redisService: RedisService,
    @Inject(rateLimitConfig.KEY)
    private readonly config: ConfigType<typeof rateLimitConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest<Request>();
    const client = this.redisService.getOrThrow();

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

  /**
   * Get the user type for rate limit policy selection
   * Backward compatible with the old strategy detection
   */
  private getUserType(
    user?: RateLimitUser,
  ): 'public' | 'auth' | 'apiKey' | 'admin' {
    if (!user) {
      return 'public';
    }

    // Admin users get admin policy
    if (user.role === 'admin' || user.role === 'super_admin') {
      return 'admin';
    }

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

  /**
   * Get the rate limit policy for the current request
   * Maintains backward compatibility with the old hardcoded limits
   */
  private getPolicyForRequest(
    request: Request,
    userType: 'public' | 'auth' | 'apiKey' | 'admin',
  ): RateLimitPolicy {
    const path = request.path || request.url || '';

    // Check for search path - backward compatible with old logic
    if (path.includes('/search')) {
      // Use config if available, otherwise fall back to search defaults
      const searchPolicy = this.config.search;
      if (searchPolicy) {
        return searchPolicy;
      }
      // Fallback to hardcoded search limit for backward compatibility
      return { limit: 30, window: 60, keyPrefix: 'search', enabled: true };
    }

    // Use the config-based policy resolution
    return getRateLimitPolicy(this.config, path, userType);
  }

  /**
   * Get unique identifier for rate limiting
   * Enhanced with better IP detection and backward compatibility
   */
  private getIdentifier(request: Request, user?: RateLimitUser): string {
    // Authenticated user: use user ID
    if (user?.id) {
      return `user:${user.id}`;
    }

    // API key: use API key ID
    if (user?.apiKeyId) {
      return `apikey:${user.apiKeyId}`;
    }

    // IP-based for public/unauthenticated requests
    // Try x-forwarded-for first (for proxied requests)
    const forwardedIp = request.headers['x-forwarded-for'] as
      | string
      | undefined;
    if (forwardedIp) {
      const ips = forwardedIp.split(',').map(ip => ip.trim());
      if (ips.length > 0 && ips[0]) {
        return `ip:${ips[0]}`;
      }
    }

    // Try request.ips (Express array)
    if (request.ips && request.ips.length > 0) {
      return `ip:${request.ips[0]}`;
    }

    // Fallback to request.ip
    if (request.ip) {
      return `ip:${request.ip}`;
    }

    // Ultimate fallback
    return 'ip:anonymous';
  }
}
