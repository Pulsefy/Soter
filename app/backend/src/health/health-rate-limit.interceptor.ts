import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Observable, of, tap } from 'rxjs';

/** Response header set on every probe response so callers can tell a fresh check from a cached one. */
export const HEALTH_CACHE_HEADER = 'X-Health-Cache';

interface CachedProbeResponse {
  statusCode: number;
  body: unknown;
  cachedAt: number;
}

interface ClientWindow {
  count: number;
  resetAt: number;
}

/**
 * Lightweight per-client rate limit for the public health probes.
 *
 * `/health`, `/health/live` and `/health/ready` must stay unauthenticated and
 * are exempt from the global throttlers (a 429 would make a load balancer pull
 * a healthy instance). That left them unbounded: `/health/ready` fans out to
 * Postgres, Redis, the AI service, Soroban RPC and the notification providers,
 * so a client calling it in a tight loop could drive real load downstream.
 *
 * This interceptor bounds that cost without ever rejecting a probe. Each
 * client (by IP) gets `HEALTH_RATE_LIMIT_MAX` requests per route per
 * `HEALTH_RATE_LIMIT_WINDOW_MS`. Within budget, the handler runs and its
 * response becomes the route's last-known status. Over budget, the handler is
 * skipped and the last-known status (body and HTTP status code) is replayed,
 * tagged with `X-Health-Cache: throttled`.
 *
 * Counters live in process memory on purpose: the limiter must keep working
 * when Redis is the dependency that is down.
 */
@Injectable()
export class HealthRateLimitInterceptor implements NestInterceptor {
  /** Upper bound on tracked clients, so a spoofed-IP flood cannot grow memory without limit. */
  static readonly MAX_TRACKED_CLIENTS = 10_000;

  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly enabled: boolean;
  private readonly windows = new Map<string, ClientWindow>();
  private readonly lastKnown = new Map<string, CachedProbeResponse>();

  constructor(config: ConfigService) {
    this.maxRequests = this.positiveInt(
      config.get<string>('HEALTH_RATE_LIMIT_MAX'),
      30,
    );
    this.windowMs = this.positiveInt(
      config.get<string>('HEALTH_RATE_LIMIT_WINDOW_MS'),
      10_000,
    );
    this.enabled = config.get<string>('HEALTH_RATE_LIMIT_ENABLED') !== 'false';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    const throttled = this.enabled && this.isOverLimit(route, req);
    const cached = this.lastKnown.get(route);
    if (throttled && cached) {
      res.status(cached.statusCode);
      res.setHeader(HEALTH_CACHE_HEADER, 'throttled');
      res.setHeader('Cache-Control', 'no-store');
      return of(cached.body);
    }

    return next.handle().pipe(
      tap(body => {
        this.lastKnown.set(route, {
          statusCode: res.statusCode,
          body,
          cachedAt: Date.now(),
        });
        res.setHeader(HEALTH_CACHE_HEADER, 'fresh');
      }),
    );
  }

  /**
   * Counts the request against the client's window and reports whether it
   * exceeds the budget. An over-budget request is still served fresh when no
   * status has been cached for the route yet.
   */
  private isOverLimit(route: string, req: Request): boolean {
    const now = Date.now();
    const key = `${route}:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
    const window = this.windows.get(key);

    if (!window || window.resetAt <= now) {
      this.evictIfFull(now);
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }

    window.count += 1;
    return window.count > this.maxRequests;
  }

  private evictIfFull(now: number): void {
    if (this.windows.size < HealthRateLimitInterceptor.MAX_TRACKED_CLIENTS) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
    // Still full of live windows: drop the oldest entry (Map keeps insertion order).
    if (this.windows.size >= HealthRateLimitInterceptor.MAX_TRACKED_CLIENTS) {
      const [oldest] = this.windows.keys();
      if (oldest !== undefined) {
        this.windows.delete(oldest);
      }
    }
  }

  private positiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }
}
