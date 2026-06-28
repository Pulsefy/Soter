/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilteredPackageList } from './FilteredPackageList';
import type { AidPackageFilters } from '@/types/aid-package';

jest.mock('@/hooks/useAidPackages', () => ({
  useAidPackages: () => ({ data: [], isLoading: false, error: null }),
}));

jest.mock('@/lib/app-role', () => ({
  getAppUserRole: () => 'viewer',
  isOperationsRole: () => false,
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('dashboard performance smoke', () => {
  it('memoizes the package list when filter props are stable', () => {
    const filters: AidPackageFilters = { search: '', status: '', token: '' };
    const { rerender } = renderWithQuery(
      <FilteredPackageList filters={filters} />,
    );

    const start = performance.now();
    for (let i = 0; i < 25; i += 1) {
      rerender(
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <FilteredPackageList filters={filters} />
        </QueryClientProvider>,
      );
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500);
  });
});
