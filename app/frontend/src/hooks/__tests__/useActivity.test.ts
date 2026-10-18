/** @jest-environment jsdom */
/**
 * Tests for useActivityFeed — migrated to the real backend endpoint.
 *
 * The real endpoint is GET /api/v1/notifications/activity-feed (NestJS global
 * `api` prefix + URI versioning), which returns the ApiResponseDto envelope
 * `{ success, message, data }` where each item matches
 * NotificationsService.ActivityFeedItem: `timestamp` as an ISO-8601 string
 * plus optional `correlationId`, `linkHref`, `linkLabel`, and `metadata`.
 *
 * The old mock handler emitted the same envelope but the hook's URL pointed
 * at a version-less path that the real backend does not serve.
 */
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useActivityFeed } from '../useActivity';

const mockFetch = jest.fn<Promise<unknown>, Parameters<typeof fetch>>();
global.fetch = mockFetch as unknown as typeof fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

/** Items shaped exactly like NotificationsService.ActivityFeedItem over the wire. */
const realFeedEnvelope = {
  success: true,
  message: 'Activity feed fetched',
  data: [
    {
      id: 'notification:abc123',
      type: 'notification',
      status: 'processing',
      title: 'SMS notification enqueued',
      description: 'Recipient claim reminder is waiting for delivery confirmation.',
      timestamp: '2026-09-26T21:44:00.000Z',
      read: false,
      correlationId: 'corr-001',
      linkHref: '/notifications/outbox/abc123',
      linkLabel: 'Open outbox record',
      metadata: { outboxId: 'abc123', recipient: '+15550001111' },
    },
    {
      id: 'review:def456',
      type: 'review',
      status: 'pending',
      title: 'Verification pending review',
      description: 'A new verification request is ready for reviewer action.',
      timestamp: '2026-09-26T21:28:00.000Z',
      read: false,
      linkHref: '/verification-review?requestId=def456',
      linkLabel: 'Open review',
      metadata: { requestId: 'def456', orgId: 'org-1' },
    },
    {
      id: 'audit:ghi789',
      type: 'audit',
      status: 'succeeded',
      title: 'update Campaign',
      description: 'Actor admin updated campaign 1',
      timestamp: '2026-09-26T20:30:00.000Z',
      read: true,
      correlationId: 'corr-003',
      linkHref: '/campaigns/1',
      linkLabel: 'Open record',
      metadata: {},
    },
  ],
};

describe('useActivityFeed (real /api/v1/notifications/activity-feed)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('requests the real versioned endpoint with the limit parameter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realFeedEnvelope),
    });

    renderHook(() => useActivityFeed(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/notifications/activity-feed?limit=30`,
    );
    expect(init).toEqual({ signal: expect.any(AbortSignal), cache: 'no-store' });
  });

  it('unwraps the ApiResponseDto envelope and hydrates timestamps to Date', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realFeedEnvelope),
    });

    const { result } = renderHook(() => useActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const items = result.current.data ?? [];
    expect(items).toHaveLength(3);
    expect(items[0].id).toBe('notification:abc123');
    items.forEach(item => {
      expect(item.timestamp).toBeInstanceOf(Date);
    });
    expect(items[0].timestamp.toISOString()).toBe('2026-09-26T21:44:00.000Z');
  });

  it('preserves real-API optional fields (correlationId, linkHref, metadata)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realFeedEnvelope),
    });

    const { result } = renderHook(() => useActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const items = result.current.data ?? [];
    expect(items[0].correlationId).toBe('corr-001');
    expect(items[0].linkHref).toBe('/notifications/outbox/abc123');
    expect(items[0].metadata).toEqual({
      outboxId: 'abc123',
      recipient: '+15550001111',
    });
  });

  it('drops malformed items instead of crashing the feed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [
            realFeedEnvelope.data[0],
            { id: 'broken', title: 'Missing fields' },
            null,
          ],
        }),
    });

    const { result } = renderHook(() => useActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].id).toBe('notification:abc123');
  });

  it('throws when the envelope reports success: false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ success: false, message: 'Activity feed unavailable' }),
    });

    const { result } = renderHook(() => useActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Activity feed unavailable');
  });

  it('throws with the status code when the endpoint responds non-2xx', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const { result } = renderHook(() => useActivityFeed(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('401');
  });
});
