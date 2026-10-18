'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ErrorState } from '@/components/ErrorState';
import { isRetrySafe, normalizeError } from '@/lib/error-utils';
import { reportClientError } from '@/utils/reportClientError';

const DEFAULT_MAX_RETRIES = 3;

export interface ErrorBoundaryProps {
  children: ReactNode;
  maxRetries?: number;
  onReset?: () => void;
}

interface InnerErrorBoundaryProps extends ErrorBoundaryProps {
  pathname?: string | null;
}

interface ErrorBoundaryState {
  error: Error | null;
  retryCount: number;
}

function useSafePathname(): string | null {
  try {
    return usePathname();
  } catch {
    return null;
  }
}

class ErrorBoundaryInner extends Component<
  InnerErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    retryCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Application error boundary caught an error.', error, errorInfo);
    }

    const normalized = normalizeError(error);
    const digest = (error as Error & { digest?: string }).digest;
    void reportClientError(error, normalized.correlationId || digest);
  }

  componentDidUpdate(prevProps: InnerErrorBoundaryProps) {
    if (
      this.state.error &&
      this.props.pathname !== undefined &&
      prevProps.pathname !== undefined &&
      this.props.pathname !== prevProps.pathname
    ) {
      this.setState({
        error: null,
        retryCount: 0,
      });
    }
  }

  handleRetry = () => {
    this.setState((currentState) => ({
      error: null,
      retryCount: currentState.retryCount + 1,
    }));
  };

  handleNavigate = () => {
    this.setState({
      error: null,
      retryCount: 0,
    });
    this.props.onReset?.();
  };

  render() {
    const { children, maxRetries = DEFAULT_MAX_RETRIES } = this.props;
    const { error, retryCount } = this.state;

    if (error) {
      const normalized = normalizeError(error);
      const canRetry = isRetrySafe(error, normalized.category) && retryCount < maxRetries;

      return (
        <ErrorState
          error={error}
          correlationId={normalized.correlationId}
          canRetry={canRetry}
          onTryAgain={canRetry ? this.handleRetry : undefined}
          onNavigate={this.handleNavigate}
        />
      );
    }

    return <React.Fragment key={retryCount}>{children}</React.Fragment>;
  }
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  const pathname = useSafePathname();
  return <ErrorBoundaryInner {...props} pathname={pathname} />;
}