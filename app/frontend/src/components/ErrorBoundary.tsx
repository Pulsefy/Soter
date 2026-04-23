'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorState } from '@/components/ErrorState';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  retryCount: number;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    retryCount: 0,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      retryCount: 0,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Application error boundary caught an error.', error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState((currentState) => ({
      error: null,
      retryCount: currentState.retryCount + 1,
    }));
  };

  render() {
    const { children } = this.props;
    const { error, retryCount } = this.state;

    if (error) {
      return (
        <ErrorState
          title="Something went wrong"
          description="We hit an unexpected problem while loading this experience. You can try the action again or return to the home page."
          error={error}
          onTryAgain={this.handleRetry}
        />
      );
    }

    return <React.Fragment key={retryCount}>{children}</React.Fragment>;
  }
}