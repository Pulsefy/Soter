/** @jest-environment jsdom */
/**
 * Tests for useAidPackages — migrated to the real API client.
 *
 * The hook now calls `apiFetch` from `@/lib/api-client`, which requests the
 * live backend at `${NEXT_PUBLIC_API_URL}/api/v1/aid/packages`. These tests
 * stub `global.fetch` (the real client's transport) instead of the demo
 * handler layer, and assert the real backend's paginated response shape
 * (`PaginatedResult<T>` from `AidService.listAidPackages`).
 */
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAidPackages } from '../useAidPackages';
import type { AidPackage, PaginatedResponse } from '@/types/aid-package';

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

/** Exact envelope returned by GET /api/v1/aid/packages. */
const mockPaginatedResponse: PaginatedResponse<AidPackage> = {
  data: [
    {
      id: 'AID-001',
      title: 'Emergency Food Relief',
      region: 'Eastern Region',
      amount: '12,500 USDC',
      recipients: 250,
      status: 'Active',
      token: 'USDC',
    },
    {
      id: 'AID-002',
      title: 'Medical Supplies',
      region: 'Northern Zone',
      amount: '8,000 USDC',
      recipients: 120,
      status: 'Active',
      token: 'USDC',
    },
  ],
  total: 50,
  page: 1,
  size: 10,
  totalPages: 5,
};

function mockOk(body: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('useAidPackages (real API client)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('requests the live aid-packages endpoint', async () => {
    mockOk(mockPaginatedResponse);

    const { result } = renderHook(() => useAidPackages(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/v1/aid/packages');
    expect(calledUrl).not.toContain('aid-packages');
  });

  it('unwraps the real paginated response envelope', async () => {
    mockOk(mockPaginatedResponse);

    const { result } = renderHook(() => useAidPackages(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockPaginatedResponse);
    expect(result.current.data?.total).toBe(50);
    expect(result.current.data?.totalPages).toBe(5);
    expect(result.current.data?.data).toHaveLength(2);
  });

  it('sends page and size params in the URL', async () => {
    mockOk(mockPaginatedResponse);

    renderHook(() => useAidPackages(undefined, { page: 3, size: 5 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/v1/aid/packages');
    expect(calledUrl).toContain('page=3');
    expect(calledUrl).toContain('size=5');
  });

  it('sends filter params in the URL', async () => {
    mockOk(mockPaginatedResponse);

    renderHook(
      () => useAidPackages({ search: 'food', status: 'Active', token: 'USDC' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('search=food');
    expect(calledUrl).toContain('status=Active');
    expect(calledUrl).toContain('token=USDC');
  });

  it('sends sort params in the URL', async () => {
    mockOk(mockPaginatedResponse);

    renderHook(
      () =>
        useAidPackages(undefined, {
          page: 1,
          size: 10,
          sortBy: 'status',
          sortDirection: 'desc',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('sortBy=status');
    expect(calledUrl).toContain('sortDirection=desc');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useAidPackages(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain('500');
  });

  it('refetches when pagination changes (queryKey cache busting)', async () => {
    mockOk(mockPaginatedResponse);

    const { result, rerender } = renderHook(
      ({ page }: { page: number }) => useAidPackages(undefined, { page, size: 10 }),
      { wrapper: createWrapper(), initialProps: { page: 1 } },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({ page: 2 });

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBe(2);
    });

    expect(String(mockFetch.mock.calls[1][0])).toContain('page=2');
  });
});
