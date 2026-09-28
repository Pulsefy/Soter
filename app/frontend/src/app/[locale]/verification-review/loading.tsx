'use client';

import React, { useEffect, useState } from 'react';

export default function VerificationReviewLoading() {
  const [showSlowMessage, setShowSlowMessage] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSlowMessage(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4 p-6 max-w-7xl mx-auto" aria-label="Loading verification review queue">
      {/* Freshness / Filter Bar Skeleton */}
      <div className="h-12 w-full rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse motion-reduce:animate-none" />

      {/* Main Queue List Skeleton matching actual layout dimensions */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-20 w-full rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center justify-between animate-pulse motion-reduce:animate-none"
          >
            <div className="flex items-center gap-3">
              <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full" />
            </div>
            <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        ))}
      </div>

      {showSlowMessage && (
        <p className="text-xs text-center text-gray-500 dark:text-gray-400 pt-2 animate-fadeIn" role="status">
          Connection appears slow. Still fetching latest review items...
        </p>
      )}
    </div>
  );
}