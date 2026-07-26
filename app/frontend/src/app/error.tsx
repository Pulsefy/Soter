'use client';

import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/ErrorState';

const MAX_RETRIES = 3;

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Route segment error.', error);
    }
  }, [error]);

  const handleRetry = () => {
    if (retryCount >= MAX_RETRIES) return;
    setRetryCount((c) => c + 1);
    reset();
  };

  return (
    <ErrorState
      title="We couldn't load this page"
      description="Soter ran into a temporary problem while preparing this route. Try again or return home to continue."
      error={error}
      onTryAgain={handleRetry}
      retryCount={retryCount}
      maxRetries={MAX_RETRIES}
    />
  );
}
