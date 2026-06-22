import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { Request } from 'express';

@Injectable()
export class AdaptiveRateLimitGuard implements CanActivate {
  private readonly limits = {
    auth: { limit: 5, window: 60 },
    search: { limit: 30, window: 60 },
    public: { limit: 10, window: 60 },
    apiKey: { limit: 100, window: 60 },
  };

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();
    const client = this.redisService.getOrThrow();

    const strategy = this.getStrategy(request);
    const { limit, window } = this.limits[strategy];
    const identifier = this.getIdentifier(request);
    const key = `ratelimit:${strategy}:${identifier}`;

    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, window);
    }

    if (current > limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests, please try again later.',
          strategy,
          limit,
          resetIn: await client.ttl(key),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getStrategy(request: any): keyof typeof this.limits {
    const path = request.path ?? request.url ?? '';
    if (path.includes('/search')) return 'search';

    const user = request.user;
    if (user) {
      if (user.authType === 'apiKey' || user.authType === 'envApiKey') {
        return 'apiKey';
      }
      return 'auth';
    }

    return 'public';
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
}
