'use client';

import React from 'react';
import { useInboxStats } from '@/hooks/useVerificationInbox';

interface StatTileProps {
  label: string;
  value: number;
  colorClass: string;
}

function StatTile({ label, value, colorClass }: StatTileProps) {
  return (
    <div className="flex-1 min-w-[120px] p-4 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

export function StatsBar() {
  const { data, isLoading } = useInboxStats();

  if (isLoading || !data) {
    return (
      <div className="flex gap-3 flex-wrap animate-pulse">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className="flex-1 min-w-[120px] h-20 rounded-lg bg-gray-100 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 flex-wrap">
      <StatTile
        label="Pending Review"
        value={data.pending_review}
        colorClass="text-yellow-600 dark:text-yellow-400"
      />
      <StatTile
        label="Approved"
        value={data.approved}
        colorClass="text-green-600 dark:text-green-400"
      />
      <StatTile
        label="Rejected"
        value={data.rejected}
        colorClass="text-red-600 dark:text-red-400"
      />
      <StatTile
        label="Needs Resubmission"
        value={data.needs_resubmission}
        colorClass="text-orange-600 dark:text-orange-400"
      />
      <StatTile
        label="Total"
        value={data.total}
        colorClass="text-gray-800 dark:text-gray-100"
      />
    </div>
  );
}
