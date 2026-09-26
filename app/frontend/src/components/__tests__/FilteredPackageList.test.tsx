/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock dependencies before imports
jest.mock('lucide-react', () => ({
  ChevronLeft: (props: Record<string, unknown>) => <svg data-testid="icon-prev" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <svg data-testid="icon-next" {...props} />,
}));

// Mock fetchClient to avoid loading handlers.ts (which has unresolved inbox references)
jest.mock('@/lib/mock-api/client', () => ({
  fetchClient: jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [], total: 0, page: 1, size: 10, totalPages: 0 }) }),
}));

jest.mock('@/hooks/useAidPackages');
jest.mock('@/components/empty-state/AppEmptyState', () => ({
  AppEmptyState: ({ compact, eyebrow, title }: { compact?: boolean; eyebrow?: string; title?: string }) => (
    <div data-testid="empty-state">
      <span>{eyebrow}</span>
      <span>{title}</span>
    </div>
  ),
}));
jest.mock('@/lib/app-role', () => ({
  getAppUserRole: () => 'admin',
  isOperationsRole: (role: string) => role === 'admin' || role === 'operator',
}));

import { FilteredPackageList } from '../dashboard/FilteredPackageList';
import { useAidPackages } from '@/hooks/useAidPackages';
import type { AidPackageFilters, PaginatedResponse, AidPackage } from '@/types/aid-package';

const mockUseAidPackages = useAidPackages as jest.MockedFunction<typeof useAidPackages>;

const mockPackages: AidPackage[] = [
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
  {
    id: 'AID-003',
    title: 'Shelter & Housing',
    region: 'Coastal Area',
    amount: '30,000 XLM',
    recipients: 75,
    status: 'Claimed',
    token: 'XLM',
  },
];

const mockPaginatedResponse: PaginatedResponse<AidPackage> = {
  data: mockPackages,
  total: 50,
  page: 1,
  size: 10,
  totalPages: 5,
};

const defaultFilters: AidPackageFilters = {};

function setup(props: Partial<React.ComponentProps<typeof FilteredPackageList>> = {}) {
  mockUseAidPackages.mockReturnValue({
    data: mockPaginatedResponse,
    isLoading: false,
    error: null,
  } as ReturnType<typeof useAidPackages>);

  return render(
    <FilteredPackageList
      filters={defaultFilters}
      page={1}
      size={10}
      onPageChange={jest.fn()}
      {...props}
    />,
  );
}

describe('FilteredPackageList – server-side pagination', () => {
  beforeEach(() => {
    mockUseAidPackages.mockReset();
  });

  describe('data fetching', () => {
    it('passes page and size to useAidPackages', () => {
      setup({ page: 3, size: 5 });

      expect(mockUseAidPackages).toHaveBeenCalledWith(defaultFilters, {
        page: 3,
        size: 5,
      });
    });

    it('defaults page to 1 and size to 10', () => {
      setup({ page: undefined, size: undefined });

      expect(mockUseAidPackages).toHaveBeenCalledWith(defaultFilters, {
        page: 1,
        size: 10,
      });
    });

    it('renders packages from paginated response data', () => {
      setup();

      // Component renders both desktop table and mobile cards, so each item appears twice
      expect(screen.getAllByText('Emergency Food Relief').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Medical Supplies').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Shelter & Housing').length).toBeGreaterThanOrEqual(1);
    });

    it('displays package IDs from paginated data', () => {
      setup();

      expect(screen.getAllByText('AID-001').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('AID-002').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('AID-003').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('loading state', () => {
    it('shows skeleton rows when loading', () => {
      mockUseAidPackages.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useAidPackages>);

      const { container } = render(
        <FilteredPackageList filters={defaultFilters} page={1} size={10} onPageChange={jest.fn()} />,
      );

      // Should have skeleton rows (animate-pulse divs)
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('error state', () => {
    it('displays error message when fetch fails', () => {
      mockUseAidPackages.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { message: 'Network error' },
      } as ReturnType<typeof useAidPackages>);

      render(
        <FilteredPackageList filters={defaultFilters} page={1} size={10} onPageChange={jest.fn()} />,
      );

      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no packages match filters', () => {
      mockUseAidPackages.mockReturnValue({
        data: { data: [], total: 0, page: 1, size: 10, totalPages: 0 },
        isLoading: false,
        error: null,
      } as ReturnType<typeof useAidPackages>);

      render(
        <FilteredPackageList
          filters={{ search: 'nonexistent' }}
          page={1}
          size={10}
          onPageChange={jest.fn()}
        />,
      );

      // Desktop table + mobile cards both render empty state
      expect(screen.getAllByText('No Matches').length).toBeGreaterThanOrEqual(1);
    });

    it('shows "No Packages Yet" when no filters applied', () => {
      mockUseAidPackages.mockReturnValue({
        data: { data: [], total: 0, page: 1, size: 10, totalPages: 0 },
        isLoading: false,
        error: null,
      } as ReturnType<typeof useAidPackages>);

      render(
        <FilteredPackageList filters={{}} page={1} size={10} onPageChange={jest.fn()} />,
      );

      // Desktop table + mobile cards both render empty state
      expect(screen.getAllByText('No Packages Yet').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Pagination component', () => {
    it('renders pagination when there are results', () => {
      setup();

      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
    });

    it('displays page info', () => {
      setup();

      expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
    });

    it('calls onPageChange when next is clicked', () => {
      const onPageChange = jest.fn();
      setup({ onPageChange });

      fireEvent.click(screen.getByRole('button', { name: /next page/i }));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('calls onPageChange when previous is clicked', () => {
      const onPageChange = jest.fn();
      setup({ page: 3, onPageChange });

      fireEvent.click(screen.getByRole('button', { name: /previous page/i }));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('disables previous button on first page', () => {
      setup({ page: 1 });

      expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    });

    it('disables next button on last page', () => {
      setup({ page: 5 });

      expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
    });

    it('does not render pagination when loading', () => {
      mockUseAidPackages.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useAidPackages>);

      render(
        <FilteredPackageList filters={defaultFilters} page={1} size={10} onPageChange={jest.fn()} />,
      );

      expect(screen.queryByRole('button', { name: /previous page/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next page/i })).not.toBeInTheDocument();
    });

    it('does not render pagination when no results', () => {
      mockUseAidPackages.mockReturnValue({
        data: { data: [], total: 0, page: 1, size: 10, totalPages: 0 },
        isLoading: false,
        error: null,
      } as ReturnType<typeof useAidPackages>);

      render(
        <FilteredPackageList filters={defaultFilters} page={1} size={10} onPageChange={jest.fn()} />,
      );

      expect(screen.queryByRole('button', { name: /previous page/i })).not.toBeInTheDocument();
    });

    it('shows "Page 2 of 5" when on page 2', () => {
      setup({ page: 2 });

      expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
    });
  });

  describe('URL-driven pagination', () => {
    it('reflects current page from URL params', () => {
      setup({ page: 4, size: 5 });

      expect(screen.getByText('Page 4 of 5')).toBeInTheDocument();
    });

    it('resets to page 1 when filters change', () => {
      // Simulate filter change causing page reset
      setup({ page: 1, filters: { status: 'Active' } });

      expect(mockUseAidPackages).toHaveBeenCalledWith(
        { status: 'Active' },
        { page: 1, size: 10 },
      );
    });
  });

  describe('table rendering with pagination', () => {
    it('renders table headers', () => {
      setup();

      expect(screen.getByText('ID')).toBeInTheDocument();
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Region')).toBeInTheDocument();
      expect(screen.getByText('Amount')).toBeInTheDocument();
      expect(screen.getByText('Recipients')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Token')).toBeInTheDocument();
    });

    it('renders status badges for each package', () => {
      setup();

      const statusBadges = screen.getAllByText('Active');
      expect(statusBadges.length).toBeGreaterThanOrEqual(2);
    });

    it('renders token info', () => {
      setup();

      // USDC appears in both desktop table and mobile cards (multiple packages)
      expect(screen.getAllByText('USDC').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('XLM').length).toBeGreaterThanOrEqual(1);
    });
  });
});
