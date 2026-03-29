'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ErrorState';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Route segment error.', error);
    }
  }, [error]);

  return (
    <ErrorState
      title="We couldn't load this page"
      description="Soter ran into a temporary problem while preparing this route. Try again or return home to continue."
      error={error}
      onTryAgain={reset}
    />
  );
}