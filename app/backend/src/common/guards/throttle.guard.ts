import { Injectable, ExecutionContext, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';
import { SKIP_THROTTLE_KEY } from '../decorators/skip-throttle.decorator';
import { shouldSkipRateLimit, SCOPE_RATE_LIMIT_MULTIPLIERS } from '../config/rate-limit.config';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { ApiKeyScope } from '../../api-keys/api-key-scope.enum';

/**
 * Enhanced ThrottlerGuard that respects @SkipThrottle() decorator
 * and globally exempt paths (health, docs, metrics)
 *
 * This guard:
 * 1. Checks if route has @SkipThrottle() decorator
 * 2. Checks if path matches globally exempt patterns
 * 3. Falls back to standard ThrottlerGuard behavior
 */
@Injectable()
export class CostAwareThrottlerGuard extends ThrottlerGuard {
  @Inject(MetricsService)
  private readonly metricsService!: MetricsService;

  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (req.user?.authType === 'apiKey' && req.user?.apiKeyId) {
      return `apikey:${req.user.apiKeyId}`;
    }
    return req.ips?.length ? req.ips[0] : req.ip;
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
    getTracker: () => Promise<string>,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Apply per-scope limits for API keys
    if (request.user?.authType === 'apiKey' && request.user?.scopes?.length > 0) {
      const multipliers = SCOPE_RATE_LIMIT_MULTIPLIERS;
      // Get the highest multiplier among the user's scopes
      const userMultiplier = Math.max(
        ...request.user.scopes.map((s: ApiKeyScope) => multipliers[s] || 1)
      );

      limit = Math.floor(limit * userMultiplier);
    }

    try {
      return await super.handleRequest(context, limit, ttl, throttler, getTracker);
    } catch (e) {
      if (e instanceof ThrottlerException) {
        // Log rejection metric
        const type = request.user?.authType === 'apiKey' ? 'apikey' : 'ip';
        this.metricsService.incrementRateLimitRejection(type, throttler.name || 'default');
      }
      throw e;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipThrottle = this.reflector.get<boolean>(
      SKIP_THROTTLE_KEY,
      context.getHandler(),
    );

    if (skipThrottle) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const path = request.path ?? request.url ?? '';

    if (shouldSkipRateLimit(path)) {
      return true;
    }

    // Delegate to parent ThrottlerGuard
    return super.canActivate(context);
  }
}
