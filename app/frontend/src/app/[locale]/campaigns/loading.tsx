'use client';

import React, { useEffect, useState } from 'react';

export default function CampaignsLoading() {
  const [showSlowMessage, setShowSlowMessage] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSlowMessage(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-gray-50 p-6 dark:to-gray-950" aria-label="Loading campaigns">
      <main className="container mx-auto space-y-8">
        {/* Header Skeleton */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="h-10 w-48 bg-gray-100 dark:bg-gray-800 rounded animate-pulse motion-reduce:animate-none" />
          <div className="h-5 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse motion-reduce:animate-none" />
        </div>

        {/* Two-column Grid Skeleton */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Column: Create New Campaign Form Skeleton */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 animate-pulse motion-reduce:animate-none">
            <div className="h-6 w-40 bg-gray-100 dark:bg-gray-800 rounded mb-4" />
            <div className="space-y-3">
              {/* Name field */}
              <div className="space-y-1">
                <div className="h-4 w-24 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-10 w-full bg-gray-100 dark:bg-gray-800 rounded-lg" />
              </div>
              {/* Budget field */}
              <div className="space-y-1">
                <div className="h-4 w-32 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-10 w-full bg-gray-100 dark:bg-gray-800 rounded-lg" />
              </div>
              {/* Token field */}
              <div className="space-y-1">
                <div className="h-4 w-20 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-10 w-full bg-gray-100 dark:bg-gray-800 rounded-lg" />
              </div>
              {/* Expiry field */}
              <div className="space-y-1">
                <div className="h-4 w-28 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-10 w-full bg-gray-100 dark:bg-gray-800 rounded-lg" />
              </div>
              {/* Buttons */}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <div className="h-10 w-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                <div className="h-10 w-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              </div>
            </div>
          </section>

          {/* Right Column: Active Campaigns List Skeleton */}
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 animate-pulse motion-reduce:animate-none">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div className="h-6 w-36 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-10 w-32 bg-gray-100 dark:bg-gray-800 rounded-md" />
            </div>

            {/* Campaign list items skeleton - matching the actual card layout */}
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="h-6 w-48 bg-gray-100 dark:bg-gray-800 rounded mb-2" />
                      <div className="h-4 w-40 bg-gray-100 dark:bg-gray-800 rounded mb-1" />
                      <div className="h-4 w-36 bg-gray-100 dark:bg-gray-800 rounded mb-1" />
                      <div className="h-4 w-36 bg-gray-100 dark:bg-gray-800 rounded" />
                    </div>
                    <div className="h-6 w-24 bg-gray-100 dark:bg-gray-800 rounded-full shrink-0" />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="h-8 w-28 bg-gray-100 dark:bg-gray-800 rounded-md" />
                    <div className="h-8 w-32 bg-gray-100 dark:bg-gray-800 rounded-md" />
                    <div className="h-8 w-20 bg-gray-100 dark:bg-gray-800 rounded-md" />
                    <div className="h-8 w-20 bg-gray-100 dark:bg-gray-800 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {showSlowMessage && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400 pt-2 animate-fadeIn" role="status">
            Connection appears slow. Still fetching campaigns...
          </p>
        )}
      </main>
    </div>
  );
}