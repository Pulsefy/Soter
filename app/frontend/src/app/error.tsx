'use client';

import React, { useEffect } from 'react';
import { reportClientError } from '@/utils/reportClientError';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, error.digest);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Something went wrong</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
        We have automatically logged this issue. Please try reloading the view.
      </p>
      <button
        onClick={() => reset()}
        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}