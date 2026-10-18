/**
 * Unified HTTP request layer with retry, backoff, jitter, deadline bounds,
 * and idempotency-key support.
 *
 * All API clients should route through `apiRequest` instead of calling
 * `fetch` directly.  This guarantees consistent transient-failure recovery,
 * observability, and timeout enforcement across the entire mobile app.
 */

import { config } from '../config';
import { buildCorrelationHeaders, structuredLogger } from './logger';

const API_URL = config.apiUrl;
const API_KEY = config.apiKey;

// ── Configuration ────────────────────────────────────────────────────────

export interface RequestConfig {
  /** HTTP method.  POST requests are guarded by an idempotency key. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path appended to `config.apiUrl` (e.g. `/aid`). */
  path: string;
  /** JSON-serialisable body (POST/PUT/PATCH). */
  body?: unknown;
  /** Extra headers merged into the default set. */
  headers?: Record<string, string>;
  /** Max retry attempts for transient failures (default: 3). */
  maxRetries?: number;
  /** Per-request deadline in milliseconds (default: 30 000). */
  deadlineMs?: number;
  /**
   * Explicit idempotency key for POST/PUT/PATCH.  When omitted and the
   * method is not GET/DELETE, a UUID-v4 is generated automatically.
   */
  idempotencyKey?: string;
  /**
   * Explicit correlation id for this request (e.g. a sync queue item's
   * correlation id).  When omitted, the session-wide logger correlation
   * id is used.  The id is sent as `x-correlation-id` / `x-request-id`
   * request headers and stamped on every log line for this request.
   */
  correlationId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const IDEMPOTENT_METHODS = new Set(['GET', 'DELETE']);

/** Generate a cryptographically random UUID-v4. */
function uuidV4(): string {
  // React Native / Expo provides `crypto.getRandomValues` via expo-crypto
  // or the built-in globals.  Falls back to Math.random for test environments.
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
    buf[8] = (buf[8] & 0x3f) | 0x80; // variant 1
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Compute exponential back-off with full jitter.
 *
 * `delay = random(0, min(cap, base * 2^attempt))`
 */
function backoffMs(attempt: number, baseMs = 200, capMs = 10_000): number {
  const exponential = baseMs * 2 ** attempt;
  const capped = Math.min(exponential, capMs);
  return Math.floor(Math.random() * capped);
}

/** Whether the HTTP status is safe to retry (transient / server-side). */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Parse a `Retry-After` header value into milliseconds.
 * Supports delay-seconds and HTTP-date forms. Returns null when absent/invalid.
 */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (header == null) {
    return null;
  }
  const trimmed = String(header).trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.floor(seconds * 1000);
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : 0;
}

/**
 * Error thrown when the server responds with HTTP 429.
 * Carries an optional Retry-After delay so callers (e.g. the sync queue)
 * can schedule a respectful backoff instead of a generic retry.
 */
export class RateLimitedError extends Error {
  readonly status = 429;
  readonly retryAfterMs: number | null;

  constructor(retryAfterMs: number | null = null, message = 'HTTP error! status: 429') {
    super(message);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

export function isRateLimitedError(error: unknown): error is RateLimitedError {
  if (error instanceof RateLimitedError) {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
  }
  return false;
}

/**
 * Delay for a rate-limited attempt inside the request layer.
 * Respects Retry-After when present; extends on consecutive 429s so the
 * schedule does not reset back to the short jittered default.
 */
function rateLimitDelayMs(
  consecutiveRateLimits: number,
  retryAfterMs: number | null,
  attempt: number,
): number {
  const streak = Math.max(1, consecutiveRateLimits);
  const jittered = backoffMs(attempt);
  // Floor grows with consecutive 429s so repeated limits extend backoff.
  const streakFloor = Math.min(200 * 2 ** streak, 10_000) * (streak > 1 ? streak : 1);

  if (retryAfterMs != null) {
    return Math.max(retryAfterMs, streak > 1 ? streakFloor : 0, streak > 1 ? jittered : 0);
  }
  return Math.max(jittered, streakFloor);
}

// ── Core request function ────────────────────────────────────────────────

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
  retries: number;
}

/**
 * Execute an HTTP request with retry, backoff, jitter, and deadline.
 *
 * - GET / DELETE are retried up to `maxRetries` times on transient failures.
 * - POST / PUT / PATCH carry an idempotency key and are retried identically.
 * - A per-request deadline aborts the chain if exceeded.
 * - Every attempt is logged via `structuredLogger`.
 */
export async function apiRequest<T = unknown>(
  cfg: RequestConfig,
): Promise<ApiResponse<T>> {
  const {
    method,
    path,
    body,
    headers: extraHeaders,
    maxRetries = 3,
    deadlineMs = 30_000,
    idempotencyKey,
    correlationId: explicitCorrelationId,
  } = cfg;

  const url = `${API_URL}${path}`;
  const correlationId = explicitCorrelationId ?? structuredLogger.getCurrentCorrelationId();
  const isIdempotent = IDEMPOTENT_METHODS.has(method);
  const effectiveIdempotencyKey = isIdempotent ? undefined : (idempotencyKey ?? uuidV4());

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
    ...buildCorrelationHeaders(correlationId),
  };
  if (effectiveIdempotencyKey) {
    baseHeaders['Idempotency-Key'] = effectiveIdempotencyKey;
  }
  if (API_KEY) {
    baseHeaders['x-api-key'] = API_KEY;
  }

  let lastError: Error | null = null;
  let retries = 0;
  let consecutiveRateLimits = 0;
  let lastRetryAfterMs: number | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const deadlineTimer = setTimeout(() => controller.abort(), deadlineMs);

    try {
      structuredLogger.info(
        'api.request.attempt',
        { url, method, attempt, correlationId },
        'api',
      );

      const response = await fetch(url, {
        method,
        headers: baseHeaders,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(deadlineTimer);

      if (!response.ok) {
        const errText = `HTTP ${response.status}`;
        structuredLogger.warn(
          'api.request.response_error',
          { url, method, status: response.status, attempt, correlationId },
          'api',
        );

        if (response.status === 429) {
          consecutiveRateLimits += 1;
          lastRetryAfterMs = parseRetryAfterMs(response.headers?.get?.('Retry-After'));
        } else {
          consecutiveRateLimits = 0;
          lastRetryAfterMs = null;
        }

        if (isRetryable(response.status) && attempt < maxRetries) {
          retries++;
          const delay =
            response.status === 429
              ? rateLimitDelayMs(consecutiveRateLimits, lastRetryAfterMs, attempt)
              : backoffMs(attempt);
          structuredLogger.info(
            'api.request.retry_scheduled',
            {
              url,
              method,
              attempt,
              delayMs: delay,
              status: response.status,
              retryAfterMs: lastRetryAfterMs,
              consecutiveRateLimits,
              correlationId,
            },
            'api',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (response.status === 429) {
          throw new RateLimitedError(lastRetryAfterMs, errText);
        }

        throw new Error(errText);
      }

      consecutiveRateLimits = 0;
      lastRetryAfterMs = null;

      const data: T = await response.json();

      if (attempt > 0) {
        structuredLogger.info(
          'api.request.retry_success',
          { url, method, attempt, retries, correlationId },
          'api',
        );
      }

      return { ok: true, status: response.status, data, retries };
    } catch (error) {
      clearTimeout(deadlineTimer);
      if (error instanceof RateLimitedError) {
        lastError = error;
        break;
      }
      lastError = error instanceof Error ? error : new Error(String(error));

      structuredLogger.warn(
        'api.request.attempt_failed',
        { url, method, attempt, error: lastError.message, correlationId },
        'api',
      );

      if (attempt < maxRetries) {
        retries++;
        const delay = backoffMs(attempt);
        structuredLogger.info(
          'api.request.retry_scheduled',
          { url, method, attempt, delayMs: delay, correlationId },
          'api',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  structuredLogger.error(
    'api.request.exhausted',
    { url, method, retries, error: lastError?.message, correlationId },
    'api',
  );

  throw lastError ?? new Error('Request failed after retries');
}

// ── Convenience wrappers ─────────────────────────────────────────────────

export const apiGet = <T = unknown>(path: string, opts?: Partial<RequestConfig>) =>
  apiRequest<T>({ method: 'GET', path, ...opts });

export const apiPost = <T = unknown>(path: string, body?: unknown, opts?: Partial<RequestConfig>) =>
  apiRequest<T>({ method: 'POST', path, body, ...opts });

export const apiPut = <T = unknown>(path: string, body?: unknown, opts?: Partial<RequestConfig>) =>
  apiRequest<T>({ method: 'PUT', path, body, ...opts });

export const apiPatch = <T = unknown>(path: string, body?: unknown, opts?: Partial<RequestConfig>) =>
  apiRequest<T>({ method: 'PATCH', path, body, ...opts });

export const apiDelete = <T = unknown>(path: string, opts?: Partial<RequestConfig>) =>
  apiRequest<T>({ method: 'DELETE', path, ...opts });
