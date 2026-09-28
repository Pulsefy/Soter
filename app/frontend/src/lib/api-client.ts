/**
 * Real API client for frontend data hooks.
 *
 * This module is the single entry point for live backend calls. Unlike
 * `lib/mock-api/client.ts`, it never intercepts a request and never fabricates
 * a response: a missing `NEXT_PUBLIC_API_URL` falls back to the documented
 * local backend default instead of silently switching to demo fixtures.
 *
 * The backend runs behind NestJS with a global `api` prefix and URI versioning
 * (`app.setGlobalPrefix('api')` + `VersioningType.URI`, default version `1`),
 * so every request is addressed as
 * `${NEXT_PUBLIC_API_URL}/api/v1/<resource>`.
 *
 * Demo/mock data stays opt-in only, via `NEXT_PUBLIC_USE_MOCKS=true`, and is
 * surfaced by the non-dismissible `DemoModeBanner`.
 */

/** Backend base URL, normalised without a trailing slash. */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
).replace(/\/+$/, '');

/** NestJS global prefix + URI version, e.g. `/api/v1`. */
export const API_VERSION_PREFIX = '/api/v1';

/**
 * `true` only when demo mode is explicitly opted into.
 *
 * Note: an unset `NEXT_PUBLIC_API_URL` does NOT enable demo mode — that
 * implicit fallback is exactly what this client removes.
 */
export function isDemoModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCKS === 'true';
}

/** Builds an absolute backend URL for a resource path (e.g. `/campaigns`). */
export function apiEndpoint(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${API_VERSION_PREFIX}${suffix}`;
}

/**
 * Performs a real request against the live backend.
 *
 * Accepts either a resource path (`/campaigns`) or an already-absolute URL.
 * The returned `Response` is the backend's own response — callers keep using
 * `res.ok` / `res.json()` exactly as they did with the mock client.
 */
export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const url = /^https?:\/\//i.test(input) ? input : apiEndpoint(input);
  return fetch(url, init);
}
