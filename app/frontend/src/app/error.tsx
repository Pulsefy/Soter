'use client';

import React, { useEffect } from 'react';
import { ErrorState } from '@/components/ErrorState';
import { isRetrySafe, normalizeError } from '@/lib/error-utils';
import { reportClientError } from '@/utils/reportClientError';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string; correlationId?: string; traceId?: string };
  reset: () => void;
}) {
  const normalized = normalizeError(error);
  const correlationId = normalized.correlationId;
  const canRetry = isRetrySafe(error, normalized.category);

  useEffect(() => {
    void reportClientError(error, correlationId || error.digest);
  }, [error, correlationId]);

  return (
    <ErrorState
      error={error}
      correlationId={correlationId}
      canRetry={canRetry}
      onTryAgain={canRetry ? reset : undefined}
      onNavigate={reset}
    />
  );
}