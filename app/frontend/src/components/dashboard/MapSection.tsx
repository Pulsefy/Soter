"use client";

import dynamic from 'next/dynamic';
import React from 'react';

function MapSkeleton() {
  return (
    <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 space-y-4 animate-pulse">
      <div className="h-5 w-48 bg-gray-100 dark:bg-gray-800 rounded" />
      <div className="h-[360px] md:h-[460px] bg-gray-100 dark:bg-gray-800 rounded-xl" />
    </div>
  );
}

const AidDistributionMap = dynamic(
  () => import('@/components/dashboard/AidDistributionMap'),
  {
    ssr: false,
    loading: () => <MapSkeleton />,
  }
);

export function MapSection() {
  return <AidDistributionMap />;
}
