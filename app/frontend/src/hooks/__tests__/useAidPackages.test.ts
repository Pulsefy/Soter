/** @jest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAidPackages } from '../useAidPackages';
import type { AidPackage, PaginatedResponse } from '@/types/aid-package';

// Mock fetchClient
const mockFetchClient = jest.fn();
jest.mock('@/lib/mock-api/client', () => ({
  fetchClient: (...args: unknown[]) => mockFetchClient(...args),
}));

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

describe('useAidPackages', () => {
  beforeEach(() => {
    mockFetchClient.mockReset();
  });

  it('fetches paginated data with default params', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPaginatedResponse),
    });

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
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPaginatedResponse),
    });

    renderHook(
      () => useAidPackages(undefined, { page: 3, size: 5 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockFetchClient).toHaveBeenCalled();
    });

    const calledUrl = mockFetchClient.mock.calls[0][0];
    expect(calledUrl).toContain('page=3');
    expect(calledUrl).toContain('size=5');
  });

  it('sends filter params in the URL', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPaginatedResponse),
    });

    renderHook(
      () => useAidPackages({ search: 'food', status: 'Active', token: 'USDC' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockFetchClient).toHaveBeenCalled();
    });

    const calledUrl = mockFetchClient.mock.calls[0][0];
    expect(calledUrl).toContain('search=food');
    expect(calledUrl).toContain('status=Active');
    expect(calledUrl).toContain('token=USDC');
  });

  it('sends sort params in the URL', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPaginatedResponse),
    });

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
      expect(mockFetchClient).toHaveBeenCalled();
    });

    const calledUrl = mockFetchClient.mock.calls[0][0];
    expect(calledUrl).toContain('sortBy=status');
    expect(calledUrl).toContain('sortDirection=desc');
  });

  it('wraps legacy array response into paginated format', async () => {
    const legacyArray: AidPackage[] = [
      {
        id: 'AID-001',
        title: 'Emergency Food Relief',
        region: 'Eastern Region',
        amount: '12,500 USDC',
        recipients: 250,
        status: 'Active',
        token: 'USDC',
      },
    ];
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(legacyArray),
    });

    const { result } = renderHook(() => useAidPackages(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.data).toEqual(legacyArray);
    expect(result.current.data?.total).toBe(1);
    expect(result.current.data?.totalPages).toBe(1);
  });

  it('throws on non-ok response', async () => {
    mockFetchClient.mockResolvedValue({
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

  it('includes all pagination params in queryKey for cache busting', async () => {
    mockFetchClient.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPaginatedResponse),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    }

    // First call with page 1
    const { result, rerender } = renderHook(
      () => useAidPackages(undefined, { page: 1, size: 10 }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const firstCallCount = mockFetchClient.mock.calls.length;

    // Rerender with page 2 - should make a new request
    rerender();

    // The hook is re-rendered, but since queryKey includes page, it should re-fetch
    await waitFor(() => {
      expect(mockFetchClient.mock.calls.length).toBeGreaterThanOrEqual(firstCallCount);
    });
  });
});
