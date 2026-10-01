/** @jest-environment jsdom */
/**
 * Tests for useCampaigns — the hook now calls the real API client
 * (`apiFetch` from `@/lib/api-client`), which requests
 * `${NEXT_PUBLIC_API_URL}/api/v1/campaigns` and unwraps the backend's
 * `ApiResponseDto` envelope (`{ success, message, data }`).
 */
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCampaign, useCampaigns } from '../useCampaigns';
import type { Campaign } from '@/types/campaign';

const mockFetch = jest.fn();
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

const mockCampaigns: Campaign[] = [
  {
    id: '1',
    name: 'Winter Relief 2026',
    budget: 25000,
    status: 'active',
    metadata: { token: 'USDC', expiry: '2026-12-31' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
];

function mockOk(body: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('useCampaigns (real API client)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('requests the live campaigns endpoint', async () => {
    mockOk({ success: true, data: mockCampaigns, message: 'Campaigns fetched successfully' });

    const { result } = renderHook(() => useCampaigns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(String(mockFetch.mock.calls[0][0])).toBe(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/campaigns`,
    );
    expect(result.current.data).toEqual(mockCampaigns);
  });

  it('requests a single campaign from the live endpoint by id', async () => {
    mockOk({ success: true, data: mockCampaigns[0], message: 'Campaign fetched successfully' });

    const { result } = renderHook(() => useCampaign('1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(String(mockFetch.mock.calls[0][0])).toContain('/api/v1/campaigns/1');
    expect(result.current.data).toEqual(mockCampaigns[0]);
  });

  it('throws when the response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useCampaigns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('503');
  });

  it('throws when the backend reports success: false', async () => {
    mockOk({ success: false, message: 'Campaigns unavailable' });

    const { result } = renderHook(() => useCampaigns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('Campaigns unavailable');
  });
});
