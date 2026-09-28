import { registerAs } from '@nestjs/config';

/**
 * Rate limit policy configuration
 * Defines rate limits per endpoint group with environment-aware overrides
 */
export interface RateLimitPolicy {
  /** Maximum number of requests allowed within the window */
  limit: number;
  /** Time window in seconds */
  window: number;
  /** Optional custom key prefix for this policy */
  keyPrefix?: string;
  /** Whether this policy is enabled */
  enabled?: boolean;
}

export interface RateLimitConfig {
  /** Default fallback policy */
  default: RateLimitPolicy;
  /** Public endpoints (no authentication) */
  public: RateLimitPolicy;
  /** Authenticated user endpoints */
  auth: RateLimitPolicy;
  /** API key authenticated endpoints */
  apiKey: RateLimitPolicy;
  /** Admin endpoints */
  admin: RateLimitPolicy;
  /** Webhook endpoints */
  webhook: RateLimitPolicy;
  /** Search endpoints (typically heavier) */
  search: RateLimitPolicy;
  /** Health/readiness endpoints (usually exempt) */
  health: RateLimitPolicy;
  /** Specific endpoint overrides */
  endpoints: Record<string, RateLimitPolicy>;
}

/**
 * Default rate limit policies
 */
const DEFAULT_POLICIES: RateLimitConfig = {
  default: {
    limit: 10,
    window: 60,
    enabled: true,
  },
  public: {
    limit: 10,
    window: 60,
    keyPrefix: 'public',
    enabled: true,
  },
  auth: {
    limit: 30,
    window: 60,
    keyPrefix: 'auth',
    enabled: true,
  },
  apiKey: {
    limit: 100,
    window: 60,
    keyPrefix: 'apikey',
    enabled: true,
  },
  admin: {
    limit: 200,
    window: 60,
    keyPrefix: 'admin',
    enabled: true,
  },
  webhook: {
    limit: 500,
    window: 60,
    keyPrefix: 'webhook',
    enabled: true,
  },
  search: {
    limit: 20,
    window: 60,
    keyPrefix: 'search',
    enabled: true,
  },
  health: {
    limit: 1000,
    window: 60,
    keyPrefix: 'health',
    enabled: true,
  },
  endpoints: {},
};

/**
 * Get rate limit policies with environment overrides
 */
function getEnvOverrides(): Partial<RateLimitConfig> {
  const overrides: Partial<RateLimitConfig> = {};

  // Environment-specific overrides
  const env = process.env.NODE_ENV || 'development';

  // Testnet/development: more lenient limits
  if (env === 'development' || env === 'test') {
    overrides.default = { limit: 20, window: 60 };
    overrides.public = { limit: 20, window: 60 };
    overrides.auth = { limit: 50, window: 60 };
    overrides.apiKey = { limit: 200, window: 60 };
    overrides.admin = { limit: 500, window: 60 };
  }

  // Production: stricter limits
  if (env === 'production') {
    overrides.default = { limit: 5, window: 60 };
    overrides.public = { limit: 5, window: 60 };
    overrides.auth = { limit: 20, window: 60 };
    overrides.apiKey = { limit: 50, window: 60 };
    overrides.admin = { limit: 100, window: 60 };
    overrides.webhook = { limit: 200, window: 60 };
  }

  // Environment variable overrides (highest priority)
  // e.g., RATE_LIMIT_PUBLIC_LIMIT=100, RATE_LIMIT_PUBLIC_WINDOW=120
  const envLimitMap = {
    default: 'RATE_LIMIT_DEFAULT',
    public: 'RATE_LIMIT_PUBLIC',
    auth: 'RATE_LIMIT_AUTH',
    apiKey: 'RATE_LIMIT_API_KEY',
    admin: 'RATE_LIMIT_ADMIN',
    webhook: 'RATE_LIMIT_WEBHOOK',
    search: 'RATE_LIMIT_SEARCH',
    health: 'RATE_LIMIT_HEALTH',
  };

  for (const [key, envPrefix] of Object.entries(envLimitMap)) {
    const limit = parseInt(process.env[`${envPrefix}_LIMIT`] || '', 10);
    const window = parseInt(process.env[`${envPrefix}_WINDOW`] || '', 10);
    const enabled = process.env[`${envPrefix}_ENABLED`];

    if (!isNaN(limit) || !isNaN(window) || enabled !== undefined) {
      const policy: RateLimitPolicy = {} as RateLimitPolicy;
      if (!isNaN(limit)) policy.limit = limit;
      if (!isNaN(window)) policy.window = window;
      if (enabled !== undefined) policy.enabled = enabled !== 'false';
      (overrides as any)[key] = policy;
    }
  }

  return overrides;
}

export default registerAs('rateLimit', (): RateLimitConfig => {
  const base = DEFAULT_POLICIES;
  const overrides = getEnvOverrides();

  // Deep merge overrides
  const config = {
    ...base,
    ...overrides,
    endpoints: {
      ...base.endpoints,
      ...(overrides.endpoints || {}),
    },
  };

  // Ensure all policies have default values
  for (const key of Object.keys(config)) {
    if (key !== 'endpoints' && typeof config[key] === 'object') {
      const policy = config[key] as RateLimitPolicy;
      if (policy.limit === undefined) {
        policy.limit = base.default.limit;
      }
      if (policy.window === undefined) {
        policy.window = base.default.window;
      }
      if (policy.keyPrefix === undefined) {
        policy.keyPrefix = key;
      }
    }
  }

  return config;
});

/**
 * Helper to get rate limit policy for a specific endpoint or group
 */
export function getRateLimitPolicy(
  config: RateLimitConfig,
  path: string,
  userType?: 'public' | 'auth' | 'apiKey' | 'admin',
): RateLimitPolicy {
  // Check for exact endpoint match first
  if (config.endpoints[path]) {
    return config.endpoints[path];
  }

  // Check for wildcard patterns
  for (const [pattern, policy] of Object.entries(config.endpoints)) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(path)) {
        return policy;
      }
    }
  }

  // Determine policy based on user type and path
  if (userType === 'admin') return config.admin;
  if (userType === 'apiKey') return config.apiKey;
  if (userType === 'auth') return config.auth;

  if (path.includes('/search')) return config.search;
  if (path.includes('/health')) return config.health;
  if (path.includes('/webhooks')) return config.webhook;

  return config.public;
}
