/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AidPackageList } from '../AidPackageList';
import type { AidPackage, PaginatedResponse } from '@/types/aid-package';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function pagePayload(page: number, size = 10, total = 25): PaginatedResponse<AidPackage> {
  const start = (page - 1) * size;
  const data = Array.from({ length: Math.min(size, total - start) }, (_, i) => {
    const n = start + i + 1;
    return {
      id: `AID-${String(n).padStart(3, '0')}`,
      title: `Package ${n}`,
      region: 'Test Region',
      amount: `${n * 100} USDC`,
      recipients: n,
      status: 'Active' as const,
      token: 'USDC' as const,
    };
  });
  return {
    data,
    total,
    page,
    size,
    totalPages: Math.ceil(total / size),
  };
}

function mockOk(body: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AidPackageList />
    </QueryClientProvider>,
  );
}

describe('AidPackageList server pagination', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('requests page and size from the server', async () => {
    mockOk(pagePayload(1));
    renderList();

    await waitFor(() => {
      expect(screen.getByText('Package 1')).toBeInTheDocument();
    });

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('/api/v1/aid/packages');
    expect(url).toContain('page=1');
    expect(url).toContain('size=10');
  });

  it('uses server total, not the loaded page length', async () => {
    mockOk(pagePayload(1, 10, 25));
    renderList();

    await waitFor(() => {
      expect(screen.getByText('Package 1')).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Package \d+/).length).toBe(10);
    expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();
  });

  it('loads a different page from the server on next', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo) => {
      const url = String(input);
      const page = Number(new URL(url, 'http://local').searchParams.get('page') ?? '1');
      return {
        ok: true,
        status: 200,
        json: async () => pagePayload(page, 10, 25),
      };
    });

    renderList();

    await waitFor(() => {
      expect(screen.getByText('Package 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Next page'));

    await waitFor(() => {
      expect(screen.getByText('Package 11')).toBeInTheDocument();
    });

    expect(screen.queryByText('Package 1')).not.toBeInTheDocument();
    const lastUrl = String(mockFetch.mock.calls.at(-1)?.[0]);
    expect(lastUrl).toContain('page=2');
  });
});
