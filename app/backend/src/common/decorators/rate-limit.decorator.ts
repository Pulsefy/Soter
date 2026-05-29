import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitConfig {
  limit: number;
  window: number; // seconds
  cost?: number; // cost weight for this endpoint (default: 1)
  skipSuccessfulRequests?: boolean; // don't count successful requests
}

export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);
