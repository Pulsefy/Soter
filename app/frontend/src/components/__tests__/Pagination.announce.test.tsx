/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Pagination } from '../Pagination';

// lucide-react icons aren't critical to test – keep the mock minimal
jest.mock('lucide-react', () => ({
  ChevronLeft: (props: Record<string, unknown>) => <svg data-testid="icon-prev" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <svg data-testid="icon-next" {...props} />,
}));

const defaultProps = {
  page: 1,
  totalPages: 5,
  pageSize: 10,
  totalItems: 47,
  onPageChange: jest.fn(),
};

function setup(props = {}) {
  const merged = { ...defaultProps, ...props };
  return render(<Pagination {...merged} />);
}

// Helper: find the single polite live region
function getLiveRegion() {
  return screen.getByRole('status');
}

describe('Pagination – rendering', () => {
  it('renders previous and next buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
  });

  it('disables Previous on first page', () => {
    setup({ page: 1 });
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
  });

  it('disables Next on last page', () => {
    setup({ page: 5, totalPages: 5 });
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('enables both buttons on a middle page', () => {
    setup({ page: 3, totalPages: 5 });
    expect(screen.getByRole('button', { name: /previous page/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).not.toBeDisabled();
  });

  it('calls onPageChange with page-1 when Previous is clicked', () => {
    const onPageChange = jest.fn();
    setup({ page: 3, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: /previous page/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with page+1 when Next is clicked', () => {
    const onPageChange = jest.fn();
    setup({ page: 3, onPageChange });
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});

describe('Pagination – ARIA live region', () => {
  it('contains exactly one element with role="status"', () => {
    setup();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('live region has aria-live="polite" and aria-atomic="true"', () => {
    setup();
    const region = getLiveRegion();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('live region is visually hidden via sr-only', () => {
    setup();
    expect(getLiveRegion()).toHaveClass('sr-only');
  });

  it('does NOT announce on initial render', () => {
    setup({ page: 1 });
    expect(getLiveRegion()).toHaveTextContent('');
  });

  it('announces after page change with correct format', () => {
    // page=2, pageSize=10, totalItems=47 → items 11–20
    const { rerender } = setup({ page: 1, totalPages: 5, pageSize: 10, totalItems: 47 });
    act(() => {
      rerender(
        <Pagination
          page={2}
          totalPages={5}
          pageSize={10}
          totalItems={47}
          onPageChange={defaultProps.onPageChange}
        />
      );
    });
    expect(getLiveRegion()).toHaveTextContent('Page 2 of 5, showing items 11–20');
  });

  it('announcement includes correct last-item when final page is partial', () => {
    // page=5, pageSize=10, totalItems=47 → items 41–47
    const { rerender } = setup({ page: 1, totalPages: 5, pageSize: 10, totalItems: 47 });
    act(() => {
      rerender(
        <Pagination
          page={5}
          totalPages={5}
          pageSize={10}
          totalItems={47}
          onPageChange={defaultProps.onPageChange}
        />
      );
    });
    expect(getLiveRegion()).toHaveTextContent('Page 5 of 5, showing items 41–47');
  });

  it('does NOT announce when the page prop is re-rendered with the same value', () => {
    const { rerender } = setup({ page: 2 });
    // First change: page 1 → 2 (announced)
    act(() => {
      rerender(
        <Pagination {...defaultProps} page={2} />
      );
    });
    const afterChange = getLiveRegion().textContent;

    // Re-render with same page – announcement must not change
    act(() => {
      rerender(
        <Pagination {...defaultProps} page={2} />
      );
    });
    expect(getLiveRegion()).toHaveTextContent(afterChange ?? '');
  });

  it('updates announcement for each subsequent page change', () => {
    const { rerender } = setup({ page: 1 });

    act(() => {
      rerender(<Pagination {...defaultProps} page={2} />);
    });
    expect(getLiveRegion()).toHaveTextContent('Page 2 of 5, showing items 11–20');

    act(() => {
      rerender(<Pagination {...defaultProps} page={3} />);
    });
    expect(getLiveRegion()).toHaveTextContent('Page 3 of 5, showing items 21–30');
  });
});

describe('Pagination – coordination with marketplace list announcer', () => {
  it('only one polite live region is present in the component output', () => {
    setup();
    const politeRegions = document
      .querySelectorAll('[aria-live="polite"]');
    // The component must not render more than one polite region
    expect(politeRegions.length).toBe(1);
  });

  it('the live region is role=status (not role=log or role=alert)', () => {
    setup();
    const region = getLiveRegion();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // assertive would compete with other live regions
    expect(region.getAttribute('aria-live')).not.toBe('assertive');
  });
});
