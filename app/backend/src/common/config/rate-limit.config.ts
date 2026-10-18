/**
 * Cost-aware rate limiting configuration
 *
 * This module defines route-specific rate limits based on endpoint cost and resource usage:
 * - Strictest: Verification endpoints (email/phone/OTP operations are costly)
 * - Strict: General verification endpoints (document processing)
 * - Moderate: General API endpoints (business logic operations)
 * - None: Health checks, metrics, docs (no limiting needed)
 *
 * All values in requests per minute per IP/API key
 */

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Rate limit definitions per endpoint category
 */
export const RATE_LIMIT_CONFIG = {
  /**
   * Verification (email/phone/OTP): Strictest limit
   * High cost due to external API calls (email, SMS providers)
   * Default: 20 requests per minute
   */
  VERIFY_OTP: {
    limit: parseNumber(process.env.THROTTLE_VERIFY_OTP_LIMIT, 20),
    ttl: parseNumber(process.env.THROTTLE_VERIFY_OTP_TTL, 60), // 60 seconds
  },

  /**
   * Verification endpoints: Strict limit
   * Document processing, verification enqueue, resend operations
   * Default: 30 requests per minute
   */
  VERIFY_ENDPOINT: {
    limit: parseNumber(process.env.THROTTLE_VERIFY_LIMIT, 30),
    ttl: parseNumber(process.env.THROTTLE_VERIFY_TTL, 60), // 60 seconds
  },

  /**
   * General API endpoints: Moderate limit
   * Standard CRUD operations, queries, business logic
   * Default: 100 requests per minute
   */
  GENERAL_ENDPOINT: {
    limit: parseNumber(process.env.THROTTLE_GENERAL_LIMIT, 100),
    ttl: parseNumber(process.env.THROTTLE_GENERAL_TTL, 60), // 60 seconds
  },

  /**
   * Search endpoints: Moderate limit
   * Queries can be expensive but are read-only
   * Default: 50 requests per minute
   */
  SEARCH_ENDPOINT: {
    limit: parseNumber(process.env.THROTTLE_SEARCH_LIMIT, 50),
    ttl: parseNumber(process.env.THROTTLE_SEARCH_TTL, 60), // 60 seconds
  },
} as const;

/**
 * Get ThrottlerModule configuration for NestJS global setup
 * Supports Redis-backed storage for multi-instance compatibility
 *
 * @returns Array of ThrottlerOptions for ThrottlerModule.forRoot()
 */
export const getThrottlerConfig = () => [
  {
    // Default throttle configuration (fallback)
    name: 'default',
    ttl: RATE_LIMIT_CONFIG.GENERAL_ENDPOINT.ttl * 1000, // Convert to ms
    limit: RATE_LIMIT_CONFIG.GENERAL_ENDPOINT.limit,
  },
  {
    // Strict verification endpoints
    name: 'verify',
    ttl: RATE_LIMIT_CONFIG.VERIFY_ENDPOINT.ttl * 1000,
    limit: RATE_LIMIT_CONFIG.VERIFY_ENDPOINT.limit,
  },
  {
    // Strictest OTP/email/phone endpoints
    name: 'verify-otp',
    ttl: RATE_LIMIT_CONFIG.VERIFY_OTP.ttl * 1000,
    limit: RATE_LIMIT_CONFIG.VERIFY_OTP.limit,
  },
  {
    // Search queries
    name: 'search',
    ttl: RATE_LIMIT_CONFIG.SEARCH_ENDPOINT.ttl * 1000,
    limit: RATE_LIMIT_CONFIG.SEARCH_ENDPOINT.limit,
  },
];

/**
 * Routes that should NOT be rate limited
 * Health checks, metrics, and docs endpoints need unrestricted access
 */
export const RATE_LIMIT_SKIP_PATHS = [
  // Health checks
  /^\/(api\/)?(v\d+\/)?health(\/|$)/i,
  /^\/(api\/)?(v\d+\/)?ping(\/|$)/i,
  // Metrics
  /^\/(api\/)?(v\d+\/)?metrics(\/|$)/i,
  // Documentation
  /^\/(api\/)?docs(\/|$)/i,
  /^\/(api\/)?(v\d+\/)?swagger(\/|$)/i,
  // OpenAPI spec
  /^\/(api\/)?swagger\.json(\/|$)/i,
  // Healthcheck alternatives
  /^\/(api\/)?(v\d+\/)?status(\/|$)/i,
] as const;

/**
 * Check if a request path should skip rate limiting
 * @param path The request path
 * @returns true if the path is exempt from rate limiting
 */
export const shouldSkipRateLimit = (path: string): boolean => {
  const normalizedPath = path.split('?')[0]; // Remove query params
  return RATE_LIMIT_SKIP_PATHS.some(pattern => pattern.test(normalizedPath));
};
