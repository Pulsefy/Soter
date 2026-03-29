'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ErrorState';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Global application error.', error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorState
          title="Soter is temporarily unavailable"
          description="The application shell failed before the page could finish loading. Retry the request or return to the home page to continue."
          error={error}
          onTryAgain={reset}
        />
      </body>
    </html>
  );
}
