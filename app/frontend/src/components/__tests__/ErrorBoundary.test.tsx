/** @jest-environment jsdom */
import React, { useState } from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorState } from '@/components/ErrorState';
import RouteErrorBoundary from '@/app/error';
import GlobalError from '@/app/global-error';
import { ApiError } from '@/lib/error-utils';

const mockBack = jest.fn();
const mockPush = jest.fn();
let mockPathname = '/campaigns';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => mockPathname,
}));

jest.mock('@/utils/reportClientError', () => ({
  reportClientError: jest.fn(),
}));

describe('ErrorBoundary and Error Screens', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/campaigns';
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('Retry actions', () => {
    it('exposes a retry action for transient errors and recovers when retried', () => {
      function FlakyChild() {
        const [shouldThrow, setShouldThrow] = useState(true);
        if (shouldThrow) {
          throw new ApiError('Service unavailable 503', 503, 'SERVICE_UNAVAILABLE', 'cid-retry-503');
        }
        return <div data-testid="recovered-view">Recovered content</div>;
      }

      function Wrapper() {
        const [fixed, setFixed] = useState(false);
        return (
          <div>
            <button type="button" onClick={() => setFixed(true)}>
              Fix upstream
            </button>
            <ErrorBoundary>
              {fixed ? <div data-testid="recovered-view">Recovered content</div> : <FlakyChild />}
            </ErrorBoundary>
          </div>
        );
      }

      render(<Wrapper />);

      expect(screen.getByRole('button', { name: /Retry action/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Fix upstream/i }));
      fireEvent.click(screen.getByRole('button', { name: /Retry action/i }));

      expect(screen.getByTestId('recovered-view')).toHaveTextContent('Recovered content');
    });

    it('hides the retry action when the error is not safe to retry (e.g. config or 403/404)', () => {
      const forbiddenError = new ApiError('Forbidden resource', 403, 'FORBIDDEN', 'cid-403');

      render(<ErrorState error={forbiddenError} onTryAgain={jest.fn()} />);

      expect(screen.queryByRole('button', { name: /Retry action/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Go back/i })).toBeInTheDocument();
    });

    it('stops exposing retry after maxRetries consecutive failures', () => {
      function AlwaysFails(): React.ReactElement {
        throw new Error('Failed to fetch data from network');
      }

      render(
        <ErrorBoundary maxRetries={2}>
          <AlwaysFails />
        </ErrorBoundary>,
      );

      // Initial failure (retryCount = 0 < 2)
      fireEvent.click(screen.getByRole('button', { name: /Retry action/i }));
      // Second failure (retryCount = 1 < 2)
      fireEvent.click(screen.getByRole('button', { name: /Retry action/i }));

      // Third failure (retryCount = 2 === maxRetries) -> retry hidden
      expect(screen.queryByRole('button', { name: /Retry action/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Go back/i })).toBeInTheDocument();
    });
  });

  describe('Navigation escape hatches without full page reload', () => {
    it('navigates back via router.back() without reloading when browser history exists', () => {
      const historyLengthSpy = jest
        .spyOn(window.history, 'length', 'get')
        .mockReturnValue(3);

      const onReset = jest.fn();

      function CrashChild(): React.ReactElement {
        throw new Error('Temporary route crash');
      }

      render(
        <ErrorBoundary onReset={onReset}>
          <CrashChild />
        </ErrorBoundary>,
      );

      fireEvent.click(screen.getByRole('button', { name: /Go back/i }));

      expect(onReset).toHaveBeenCalledTimes(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();

      historyLengthSpy.mockRestore();
    });

    it('falls back to client-side router.push("/") when no history entry is available', () => {
      const historyLengthSpy = jest
        .spyOn(window.history, 'length', 'get')
        .mockReturnValue(1);

      render(<ErrorState error={new Error('Direct entry failure')} />);

      fireEvent.click(screen.getByRole('button', { name: /Go back/i }));

      expect(mockPush).toHaveBeenCalledWith('/');
      expect(mockBack).not.toHaveBeenCalled();

      historyLengthSpy.mockRestore();
    });

    it('clears the error boundary automatically when the route pathname changes', () => {
      let shouldThrow = true;
      function RouteChild() {
        if (shouldThrow) {
          throw new Error('Route failure');
        }
        return <div data-testid="new-route-content">Healthy route</div>;
      }

      const { rerender } = render(
        <ErrorBoundary>
          <RouteChild />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('button', { name: /Go back/i })).toBeInTheDocument();

      shouldThrow = false;
      mockPathname = '/dashboard';

      rerender(
        <ErrorBoundary>
          <RouteChild />
        </ErrorBoundary>,
      );

      expect(screen.getByTestId('new-route-content')).toHaveTextContent('Healthy route');
    });
  });

  describe('Correlation ID surfacing', () => {
    it('displays the backend correlation ID in ErrorState and ErrorBoundary', () => {
      function FailingApiChild(): React.ReactElement {
        throw new ApiError(
          'Backend database timeout',
          503,
          'SERVICE_UNAVAILABLE',
          'corr-backend-98765',
        );
      }

      render(
        <ErrorBoundary>
          <FailingApiChild />
        </ErrorBoundary>,
      );

      const badge = screen.getByTestId('error-correlation-id');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Correlation ID:');
      expect(badge).toHaveTextContent('corr-backend-98765');
    });

    it('does not render correlation ID badge when the error has no backend correlation ID', () => {
      render(<ErrorState error={new Error('Local client error')} />);

      expect(screen.queryByTestId('error-correlation-id')).not.toBeInTheDocument();
    });

    it('surfaces correlation ID and navigation actions in Next.js route error boundary (app/error.tsx)', () => {
      const reset = jest.fn();
      const err = Object.assign(new Error('Server 502 bad gateway'), {
        correlationId: 'route-cid-1122',
      });

      render(<RouteErrorBoundary error={err} reset={reset} />);

      expect(screen.getByTestId('error-correlation-id')).toHaveTextContent('route-cid-1122');
      expect(screen.getByRole('button', { name: /Retry action/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Go back/i })).toBeInTheDocument();
    });

    it('surfaces correlation ID and avoids unsafe retry in GlobalError (app/global-error.tsx)', () => {
      const reset = jest.fn();
      const err = Object.assign(new Error('Forbidden shell access'), {
        status: 403,
        correlationId: 'global-cid-4455',
      });

      render(<GlobalError error={err} reset={reset} />);

      expect(screen.getByTestId('global-error-correlation-id')).toHaveTextContent('global-cid-4455');
      expect(screen.queryByRole('button', { name: /Retry Request/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Go back/i })).toBeInTheDocument();
    });
  });
});
