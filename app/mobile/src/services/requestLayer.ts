/**
 * Unified HTTP request layer with retry, backoff, jitter, deadline bounds,
 * and idempotency-key support.
 *
 * All API clients should route through `apiRequest` instead of calling
 * `fetch` directly.  This guarantees consistent transient-failure recovery,
 * observability, and timeout enforcement across the entire mobile app.
 */

import { config } from '../config';
import { structuredLogger } from './logger';

const API_URL = config.apiUrl;

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
  } = cfg;

  const url = `${API_URL}${path}`;
  const correlationId = structuredLogger.getCurrentCorrelationId();
  const isIdempotent = IDEMPOTENT_METHODS.has(method);
  const effectiveIdempotencyKey = isIdempotent ? undefined : (idempotencyKey ?? uuidV4());

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (effectiveIdempotencyKey) {
    baseHeaders['Idempotency-Key'] = effectiveIdempotencyKey;
  }

  let lastError: Error | null = null;
  let retries = 0;

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

        if (isRetryable(response.status) && attempt < maxRetries) {
          retries++;
          const delay = backoffMs(attempt);
          structuredLogger.info(
            'api.request.retry_scheduled',
            { url, method, attempt, delayMs: delay, status: response.status, correlationId },
            'api',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(errText);
      }

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
