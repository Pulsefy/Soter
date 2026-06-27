/**
 * Unit tests for error-utils.ts
 *
 * Covers:
 *  - ApiError constructor
 *  - extractApiError — extracts correlation IDs from response headers and JSON body
 *  - normalizeError  — handles ApiError, Error, string, object, and unknown inputs
 *  - categorizeError — correct category assignment
 */

import { ApiError, categorizeError, extractApiError, normalizeError } from './error-utils';

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function makeResponse(
  status: number,
  body: object | string | null,
  headers: Record<string, string> = {},
): Response {
  const bodyStr = body !== null ? JSON.stringify(body) : '';
  return new Response(bodyStr, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/* ─── ApiError ────────────────────────────────────────────────────────── */

describe('ApiError', () => {
  it('stores all fields', () => {
    const err = new ApiError('bad request', 400, 'corr-abc', { field: 'x' });
    expect(err.message).toBe('bad request');
    expect(err.status).toBe(400);
    expect(err.correlationId).toBe('corr-abc');
    expect(err.details).toEqual({ field: 'x' });
    expect(err.name).toBe('ApiError');
    expect(err instanceof Error).toBe(true);
  });

  it('works with defaults (no optional args)', () => {
    const err = new ApiError('oops');
    expect(err.status).toBeUndefined();
    expect(err.correlationId).toBeUndefined();
    expect(err.details).toBeUndefined();
  });
});

/* ─── extractApiError ─────────────────────────────────────────────────── */

describe('extractApiError', () => {
  it('extracts message from JSON body', async () => {
    const res = makeResponse(422, { message: 'Validation failed' });
    const err = await extractApiError(res);
    expect(err.message).toBe('Validation failed');
    expect(err.status).toBe(422);
  });

  it('joins array messages from NestJS validation', async () => {
    const res = makeResponse(400, { message: ['field a is required', 'field b must be string'] });
    const err = await extractApiError(res);
    expect(err.message).toBe('field a is required, field b must be string');
  });

  it('falls back to generic message when body has no message key', async () => {
    const res = makeResponse(500, { error: 'internal thing' });
    const err = await extractApiError(res);
    expect(err.message).toBe('API request failed with status 500');
  });

  it('reads correlationId from x-correlation-id response header', async () => {
    const res = makeResponse(503, { message: 'Service unavailable' }, { 'x-correlation-id': 'hdr-cid-123' });
    const err = await extractApiError(res);
    expect(err.correlationId).toBe('hdr-cid-123');
  });

  it('reads correlationId from x-request-id when x-correlation-id is absent', async () => {
    const res = makeResponse(502, { message: 'Bad gateway' }, { 'x-request-id': 'req-id-999' });
    const err = await extractApiError(res);
    expect(err.correlationId).toBe('req-id-999');
  });

  it('prefers traceId from body over header correlationId', async () => {
    const res = makeResponse(
      500,
      { message: 'Error', traceId: 'body-trace-xyz' },
      { 'x-correlation-id': 'hdr-cid' },
    );
    const err = await extractApiError(res);
    expect(err.correlationId).toBe('body-trace-xyz');
  });

  it('handles non-JSON body gracefully', async () => {
    const res = new Response('Internal Server Error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
    const err = await extractApiError(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });
});

/* ─── normalizeError ──────────────────────────────────────────────────── */

describe('normalizeError', () => {
  it('handles ApiError with all fields', () => {
    const apiErr = new ApiError('Upstream error', 503, 'cid-789', { detail: true });
    const norm = normalizeError(apiErr);
    expect(norm.message).toBe('Upstream error');
    expect(norm.status).toBe(503);
    expect(norm.correlationId).toBe('cid-789');
    expect(norm.details).toEqual({ detail: true });
  });

  it('handles a plain Error instance', () => {
    const err = new Error('Something broke');
    const norm = normalizeError(err);
    expect(norm.message).toBe('Something broke');
    expect(norm.correlationId).toBeUndefined();
  });

  it('extracts correlationId from a plain Error with extra fields', () => {
    const err = Object.assign(new Error('Network error'), { correlationId: 'extra-cid', status: 404 });
    const norm = normalizeError(err);
    expect(norm.correlationId).toBe('extra-cid');
    expect(norm.status).toBe(404);
  });

  it('handles a string error', () => {
    const norm = normalizeError('something went wrong');
    expect(norm.message).toBe('something went wrong');
    expect(norm.category).toBeDefined();
  });

  it('handles a plain object with message', () => {
    const norm = normalizeError({ message: 'Object error', status: 400, correlationId: 'obj-cid' });
    expect(norm.message).toBe('Object error');
    expect(norm.status).toBe(400);
    expect(norm.correlationId).toBe('obj-cid');
  });

  it('handles null safely', () => {
    const norm = normalizeError(null);
    expect(norm.message).toBe('An unexpected error occurred.');
    expect(norm.category).toBe('unknown');
  });

  it('handles undefined safely', () => {
    const norm = normalizeError(undefined);
    expect(norm.message).toBe('An unexpected error occurred.');
  });
});

/* ─── categorizeError ─────────────────────────────────────────────────── */

describe('categorizeError', () => {
  it('returns wallet for freighter-related messages', () => {
    expect(categorizeError(new Error('freighter not found'))).toBe('wallet');
    expect(categorizeError(new Error('user declined to sign'))).toBe('wallet');
    expect(categorizeError(new Error('wallet locked'))).toBe('wallet');
  });

  it('returns network for connectivity messages', () => {
    expect(categorizeError(new Error('Failed to fetch resource'))).toBe('network');
    expect(categorizeError(new Error('DNS lookup failed'))).toBe('network');
    expect(categorizeError(new Error('request aborted'))).toBe('network');
  });

  it('returns server for 5xx-related messages', () => {
    expect(categorizeError(new Error('server error 503'))).toBe('server');
    expect(categorizeError(new Error('bad gateway received'))).toBe('server');
    expect(categorizeError(new Error('service unavailable 504'))).toBe('server');
  });

  it('returns unknown for unrecognized messages', () => {
    expect(categorizeError(new Error('something unrelated'))).toBe('unknown');
    expect(categorizeError(null)).toBe('unknown');
  });
});
