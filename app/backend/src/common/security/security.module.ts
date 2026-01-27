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

const isRateLimitExempt = (req: Request): boolean => {
  const path = req.path ?? req.originalUrl ?? req.url ?? '';
  const normalizedPath = path.split('?')[0];
  return RATE_LIMIT_EXEMPT_PATHS.some(pattern => pattern.test(normalizedPath));
};

// Explicit Helmet configuration: only the required headers are enabled.
const buildHelmetOptions = (): HelmetOptions => ({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
  referrerPolicy: { policy: 'no-referrer' },
  strictTransportSecurity: false,
  xContentTypeOptions: true,
  xDnsPrefetchControl: false,
  xDownloadOptions: false,
  xFrameOptions: { action: 'deny' },
  xPermittedCrossDomainPolicies: false,
  xPoweredBy: false,
  xXssProtection: false,
});

export const createHelmetMiddleware = () => helmet(buildHelmetOptions());

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

export const buildCorsOptions = (config: ConfigService): CorsOptions => {
  const allowedOrigins = resolveAllowedOrigins(config);
  const allowCredentials = parseBoolean(
    config.get<string>('CORS_ALLOW_CREDENTIALS'),
    false,
  );

  return {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, false);
      }

      const normalizedOrigin = normalizeOrigin(origin);
      if (allowedOrigins.includes(normalizedOrigin)) {
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
  const allowedOrigins = resolveAllowedOrigins(config);

  return (req: Request, res: Response, next: NextFunction) => {
    const originHeader = req.headers.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (!origin) {
      next();
      return;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (!allowedOrigins.includes(normalizedOrigin)) {
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

    const now = Date.now();
    cleanupExpiredEntries(now);

    const forwardedIp =
      Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
    const key = forwardedIp ?? req.ip ?? 'unknown';
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
