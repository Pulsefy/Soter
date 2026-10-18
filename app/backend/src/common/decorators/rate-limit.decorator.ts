import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { RateLimitPolicy } from '../../config/rate-limit.config';
import { AdaptiveRateLimitGuard } from '../guards/adaptive-rate-limit.guard';

/**
 * Metadata key for custom rate limit policies
 */
export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Custom rate limit policy decorator
 * Overrides the default rate limit for a specific endpoint
 */
export function RateLimit(
  limit: number,
  window: number,
  options?: { keyPrefix?: string; enabled?: boolean },
): MethodDecorator {
  const policy: RateLimitPolicy = {
    limit,
    window,
    ...options,
  };

  return applyDecorators(
    SetMetadata(RATE_LIMIT_KEY, policy),
    UseGuards(AdaptiveRateLimitGuard),
    ApiResponse({
      status: 429,
      description: 'Too Many Requests - Rate limit exceeded',
    }),
  );
}

/**
 * Skip rate limiting for an endpoint
 */
export function SkipRateLimit(): MethodDecorator {
  return applyDecorators(
    SetMetadata(RATE_LIMIT_KEY, { limit: Infinity, window: 1, enabled: false }),
    UseGuards(AdaptiveRateLimitGuard),
  );
}

/**
 * Apply public rate limit (most lenient)
 */
export function PublicRateLimit(): MethodDecorator {
  return RateLimit(20, 60, { keyPrefix: 'public', enabled: true });
}

/**
 * Apply auth rate limit (standard for authenticated users)
 */
export function AuthRateLimit(): MethodDecorator {
  return RateLimit(30, 60, { keyPrefix: 'auth', enabled: true });
}

/**
 * Apply admin rate limit (higher limit for admins)
 */
export function AdminRateLimit(): MethodDecorator {
  return RateLimit(200, 60, { keyPrefix: 'admin', enabled: true });
}

/**
 * Apply webhook rate limit (very high limit for webhooks)
 */
export function WebhookRateLimit(): MethodDecorator {
  return RateLimit(500, 60, { keyPrefix: 'webhook', enabled: true });
}

/**
 * Apply search rate limit (lower limit for search endpoints)
 */
export function SearchRateLimit(): MethodDecorator {
  return RateLimit(20, 60, { keyPrefix: 'search', enabled: true });
}
