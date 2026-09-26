import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for response caching configuration
 */
export const CACHE_RESPONSE_KEY = 'cache:response';

/**
 * Options for the CacheResponse decorator
 */
export interface CacheResponseOptions {
  /**
   * Time-to-live in seconds for the cached response
   * @example 300 // 5 minutes
   */
  ttl: number;

  /**
   * Optional key generator function to create cache keys from request context.
   * If not provided, defaults to normalizing route + query params + body.
   *
   * @param req - Express request object
   * @returns Cache key string
   */
  keyGenerator?: (req: any) => string;

  /**
   * Optional flag to include request body in cache key generation.
   * Default: false (only route + query params)
   */
  includeBody?: boolean;

  /**
   * Cache key prefix for namespacing. Default: 'cache:response'
   */
  prefix?: string;
}

/**
 * Decorator to enable response caching for GET endpoints.
 * Uses Redis to cache responses based on normalized request inputs.
 *
 * @example
 * ```typescript
 * @Get('verification/:id')
 * @CacheResponse({ ttl: 300 }) // Cache for 5 minutes
 * async getVerification(@Param('id') id: string) {
 *   return this.verificationService.getVerification(id);
 * }
 * ```
 *
 * @example Custom key generator
 * ```typescript
 * @Get('stats')
 * @CacheResponse({
 *   ttl: 600,
 *   keyGenerator: (req) => `stats:${req.user?.id || 'anonymous'}`
 * })
 * async getStats() {
 *   return this.analyticsService.getStats();
 * }
 * ```
 */
export const CacheResponse = (options: CacheResponseOptions) =>
  SetMetadata(CACHE_RESPONSE_KEY, options);
