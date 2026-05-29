import { Module } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet, { HelmetOptions } from 'helmet';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
];
const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_CORS_METHODS = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
  'OPTIONS',
];

const RATE_LIMIT_EXEMPT_PATHS = [
  /^\/(api\/)?(v\d+\/)?health(\/|$)/i,
  /^\/(api\/)?(v\d+\/)?metrics(\/|$)/i,
  /^\/(api\/)?docs(\/|$)/i,
];

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, '');

const parseAllowedOrigins = (value: string | undefined): string[] => {
  if (value === undefined) {
    return [];
  }

  const parsed = value
    .split(',')
    .map(origin => normalizeOrigin(origin.trim()))
    .filter(origin => origin.length > 0 && origin !== '*');

  return Array.from(new Set(parsed));
};

/**
 * Parse allowlist patterns for CORS origins.
 * Supports exact matches and wildcard patterns for Vercel preview deployments.
 *
 * Examples:
 * - "https://app.example.com" (exact match)
 * - "https://*.vercel.app" (wildcard for Vercel previews)
 * - "https://pr-*.example-app.vercel.app" (specific pattern)
 */
const parseAllowlistPatterns = (
  value: string | undefined,
): Array<{ pattern: string; isWildcard: boolean; regex?: RegExp }> => {
  if (value === undefined) {
    return [];
  }

  const patterns = value
    .split(',')
    .map(pattern => normalizeOrigin(pattern.trim()))
    .filter(pattern => pattern.length > 0 && pattern !== '*');

  return patterns.map(pattern => {
    if (pattern.includes('*')) {
      // Convert wildcard pattern to regex
      // Escape special regex characters except *
      const escapedPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^.]*'); // * matches any characters except dots (for subdomain safety)

      const regex = new RegExp(`^${escapedPattern}$`, 'i');
      return { pattern, isWildcard: true, regex };
    }

    return { pattern, isWildcard: false };
  });
};

/**
 * Check if an origin matches any of the allowlist patterns.
 */
const isOriginAllowed = (
  origin: string,
  allowlistPatterns: Array<{
    pattern: string;
    isWildcard: boolean;
    regex?: RegExp;
  }>,
): boolean => {
  const normalizedOrigin = normalizeOrigin(origin);

  for (const { pattern, isWildcard, regex } of allowlistPatterns) {
    if (isWildcard && regex) {
      if (regex.test(normalizedOrigin)) {
        return true;
      }
    } else if (normalizedOrigin === pattern) {
      return true;
    }
  }

  return false;
};

const isRateLimitExempt = (req: Request): boolean => {
  const path = req.path ?? req.originalUrl ?? req.url ?? '';
  const normalizedPath = path.split('?')[0];
  return RATE_LIMIT_EXEMPT_PATHS.some(pattern => pattern.test(normalizedPath));
};

// Explicit Helmet configuration: recommended security headers for production
const buildHelmetOptions = (config: ConfigService): HelmetOptions => {
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';

  return {
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: isProduction ? { policy: 'same-origin' } : false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: isProduction
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: false,
    xFrameOptions: { action: 'deny' },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xPoweredBy: false,
    xXssProtection: false,
  };
};

export const createHelmetMiddleware = (config: ConfigService) =>
  helmet(buildHelmetOptions(config));

const resolveAllowedOrigins = (config: ConfigService): string[] => {
  const rawOrigins = config.get<string>('CORS_ORIGINS');
  const nodeEnv = config.get<string>('NODE_ENV');
  if (rawOrigins === undefined) {
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      return DEFAULT_ALLOWED_ORIGINS;
    }

    return [];
  }

  return parseAllowedOrigins(rawOrigins);
};

/**
 * Resolve CORS allowlist patterns from environment configuration.
 * Supports both legacy CORS_ORIGINS and new CORS_ALLOWLIST for pattern matching.
 */
const resolveAllowlistPatterns = (
  config: ConfigService,
): Array<{ pattern: string; isWildcard: boolean; regex?: RegExp }> => {
  const nodeEnv = config.get<string>('NODE_ENV');

  // Check for new allowlist configuration first
  const allowlistConfig = config.get<string>('CORS_ALLOWLIST');
  if (allowlistConfig !== undefined) {
    return parseAllowlistPatterns(allowlistConfig);
  }

  // Fallback to legacy CORS_ORIGINS for backward compatibility
  const legacyOrigins = config.get<string>('CORS_ORIGINS');
  if (legacyOrigins !== undefined) {
    return parseAllowlistPatterns(legacyOrigins);
  }

  // Default behavior for development/test
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return parseAllowlistPatterns(DEFAULT_ALLOWED_ORIGINS.join(','));
  }

  return [];
};

export const buildCorsOptions = (config: ConfigService): CorsOptions => {
  const allowlistPatterns = resolveAllowlistPatterns(config);
  const allowCredentials = parseBoolean(
    config.get<string>('CORS_ALLOW_CREDENTIALS'),
    false,
  );

  return {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, false);
      }

      if (isOriginAllowed(origin, allowlistPatterns)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    methods: DEFAULT_CORS_METHODS.join(','),
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
  };
};

export const createCorsOriginValidator = (
  config: ConfigService,
): RequestHandler => {
  const allowlistPatterns = resolveAllowlistPatterns(config);

  return (req: Request, res: Response, next: NextFunction) => {
    const originHeader = req.headers.origin as string | string[] | undefined;
    const originRaw: string | undefined = Array.isArray(originHeader)
      ? originHeader[0]
      : originHeader;
    const origin: string | undefined =
      typeof originRaw === 'string' ? originRaw : undefined;
    if (!origin) {
      next();
      return;
    }

    if (!isOriginAllowed(origin, allowlistPatterns)) {
      res.status(403).send('Not allowed by CORS');
      return;
    }

    next();
  };
};

export const createRateLimiter = (config: ConfigService): RequestHandler => {
  const windowMs = parseNumber(
    config.get<string>('THROTTLE_TTL'),
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  const limit = parseNumber(
    config.get<string>('API_RATE_LIMIT'),
    DEFAULT_RATE_LIMIT,
  );

  const store = new Map<string, { count: number; resetTimeMs: number }>();
  let lastCleanupMs = 0;

  const cleanupExpiredEntries = (now: number) => {
    if (now - lastCleanupMs < windowMs) {
      return;
    }

    lastCleanupMs = now;
    for (const [key, entry] of store) {
      if (entry.resetTimeMs <= now) {
        store.delete(key);
      }
    }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (isRateLimitExempt(req)) {
      next();
      return;
    }

    // Apply rate limiting for verification endpoints always,
    // otherwise only apply to unauthenticated requests (no Authorization header)
    const path = req.path ?? req.originalUrl ?? req.url ?? '';
    const normalizedPath = path.split('?')[0];
    const isVerificationPath = /^\/(api\/)?(v\d+\/)?verification(\/|$)/i.test(
      normalizedPath,
    );

    const hasAuthHeader = !!(
      (req.headers &&
        (req.headers.authorization || req.headers.Authorization)) ||
      req.user
    );

    if (!isVerificationPath && hasAuthHeader) {
      // Authenticated non-verification requests are not rate-limited here
      next();
      return;
    }

    const now = Date.now();
    cleanupExpiredEntries(now);

    const forwardedIp =
      Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
    const key: string =
      (typeof forwardedIp === 'string' ? forwardedIp : undefined) ??
      (typeof req.ip === 'string' ? req.ip : undefined) ??
      'unknown';
    let entry = store.get(key);
    if (!entry || entry.resetTimeMs <= now) {
      entry = { count: 0, resetTimeMs: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(limit - entry.count, 0);
    const resetSeconds = Math.max(
      Math.ceil((entry.resetTimeMs - now) / 1000),
      0,
    );

    res.setHeader('RateLimit-Limit', limit.toString());
    res.setHeader('RateLimit-Remaining', remaining.toString());
    res.setHeader('RateLimit-Reset', resetSeconds.toString());

    if (entry.count > limit) {
      res.setHeader('Retry-After', resetSeconds.toString());
      res.status(429).send('Too many requests, please try again later.');
      return;
    }

    next();
  };
};

@Module({})
export class SecurityModule {}
