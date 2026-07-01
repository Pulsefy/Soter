import { SetMetadata } from '@nestjs/common';

/**
 * Skip rate limiting for this route
 * Used for health checks, metrics, and other high-traffic endpoints
 * that should not be throttled
 *
 * @example
 * ```ts
 * @Get('health')
 * @SkipThrottle()
 * check() {
 *   return { status: 'ok' };
 * }
 * ```
 */
export const SKIP_THROTTLE_KEY = 'skipThrottle';
export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);
