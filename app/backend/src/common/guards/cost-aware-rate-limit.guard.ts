import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Reflector,
} from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Request } from 'express';
import { RATE_LIMIT_KEY, RateLimitConfig } from '../decorators/rate-limit.decorator';

/**
 * Cost-aware rate limiting guard that enforces per-endpoint rate limits
 * based on the cost of the operation and user authentication status.
 */
@Injectable()
export class CostAwareRateLimitGuard implements CanActivate {
  // Default limits for different user types
  private readonly defaultLimits = {
    public: { limit: 10, window: 60 }, // 10 requests per minute
    authenticated: { limit: 100, window: 60 }, // 100 requests per minute
    apiKey: { limit: 1000, window: 60 }, // 1000 requests per minute
  };

  // Default costs for different endpoint categories
  private readonly defaultCosts = {
    read: 1, // GET requests
    write: 5, // POST/PUT/PATCH requests
    expensive: 20, // On-chain operations, expensive computations
    bulk: 50, // Bulk operations
  };

  constructor(
    private readonly redisService: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();
    const response = context.switchToHttp().getResponse();
    const client = this.redisService.getOrThrow();

    // Get endpoint-specific rate limit config from decorator
    const endpointConfig = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    // Get user type for default limits
    const userType = this.getUserType(request);
    const defaultLimit = this.defaultLimits[userType];

    // Calculate effective limit and cost
    const config = this.calculateEffectiveConfig(
      endpointConfig,
      defaultLimit,
      request,
    );

    const identifier = this.getIdentifier(request);
    const endpointKey = this.getEndpointKey(request);
    const key = `ratelimit:${userType}:${endpointKey}:${identifier}`;

    // Get current usage
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, config.window);
    }

    // Calculate remaining requests (accounting for cost)
    const remaining = Math.floor((config.limit - current * config.cost) / config.cost);

    // Set rate limit headers
    this.setRateLimitHeaders(response, config, remaining, key, client);

    // Check if limit exceeded
    if (current * config.cost > config.limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          limit: config.limit,
          remaining: Math.max(remaining, 0),
          resetIn: await client.ttl(key),
          cost: config.cost,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getUserType(request: any): keyof typeof this.defaultLimits {
    const user = request.user;
    if (user) {
      if (user.authType === 'apiKey' || user.authType === 'envApiKey') {
        return 'apiKey';
      }
      return 'authenticated';
    }
    return 'public';
  }

  private calculateEffectiveConfig(
    endpointConfig: RateLimitConfig | undefined,
    defaultLimit: { limit: number; window: number },
    request: any,
  ): RateLimitConfig {
    if (endpointConfig) {
      return {
        limit: endpointConfig.limit,
        window: endpointConfig.window,
        cost: endpointConfig.cost || 1,
        skipSuccessfulRequests: endpointConfig.skipSuccessfulRequests,
      };
    }

    // Auto-calculate based on HTTP method and path
    const method = request.method?.toLowerCase() || 'get';
    const path = request.path || request.url || '';

    let cost = this.defaultCosts.read;
    if (['post', 'put', 'patch'].includes(method)) {
      cost = this.defaultCosts.write;
    }
    if (path.includes('/disburse') || path.includes('/onchain')) {
      cost = this.defaultCosts.expensive;
    }
    if (path.includes('/bulk') || path.includes('/batch')) {
      cost = this.defaultCosts.bulk;
    }

    return {
      limit: defaultLimit.limit,
      window: defaultLimit.window,
      cost,
    };
  }

  private getIdentifier(request: any): string {
    const user = request.user;
    if (user?.id) return user.id;
    if (user?.apiKeyId) return user.apiKeyId;

    const forwardedIp =
      Array.isArray(request.ips) && request.ips.length > 0
        ? request.ips[0]
        : undefined;
    return forwardedIp ?? request.ip ?? 'anonymous';
  }

  private getEndpointKey(request: any): string {
    const method = request.method?.toLowerCase() || 'get';
    const path = request.path || request.url || '';
    // Normalize path to group similar endpoints
    const normalizedPath = path.replace(/\/\d+/g, '/:id');
    return `${method}:${normalizedPath}`;
  }

  private async setRateLimitHeaders(
    response: any,
    config: RateLimitConfig,
    remaining: number,
    key: string,
    client: any,
  ): Promise<void> {
    const ttl = await client.ttl(key);
    
    response.setHeader('RateLimit-Limit', config.limit.toString());
    response.setHeader('RateLimit-Remaining', Math.max(remaining, 0).toString());
    response.setHeader('RateLimit-Reset', ttl.toString());
    response.setHeader('RateLimit-Cost', config.cost.toString());
    response.setHeader('RateLimit-Window', config.window.toString());
  }
}
