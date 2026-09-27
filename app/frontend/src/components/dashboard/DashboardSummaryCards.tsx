'use client';

import { useEffect, useState } from 'react';
import { fetchGlobalStats, type GlobalStats } from '@/lib/analytics-api';

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <article className="p-6 rounded-lg border border-gray-200 dark:border-gray-800">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
        {description}
      </p>
    </article>
  );
}

export function DashboardSummaryCards() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadStats() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchGlobalStats();
        if (active) setStats(result);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load dashboard summary.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadStats();
    return () => {
      active = false;
    };
  }, [attempt]);

  if (loading) {
    return (
      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
        role="status"
        aria-label="Loading dashboard summary"
      >
        <span className="sr-only">Loading dashboard summary...</span>
        {[0, 1, 2].map(item => (
          <div
            key={item}
            className="h-32 rounded-lg border border-gray-200 dark:border-gray-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div
        className="rounded-lg border border-red-200 dark:border-red-900 p-5"
        role="alert"
      >
        <p className="font-medium">Dashboard summary unavailable</p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {error ?? 'The analytics service returned no dashboard summary.'}
        </p>
        <button
          type="button"
          className="mt-3 text-sm font-medium text-blue-700 dark:text-blue-300 underline"
          onClick={() => setAttempt(current => current + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-3 gap-6"
      aria-label="Dashboard summary"
    >
      <SummaryCard
        title="Active Campaigns"
        value={formatCount(stats.activeCampaigns)}
        description="Currently accepting aid claims"
      />
      <SummaryCard
        title="Total Distributed"
        value={formatCount(stats.totalAidDisbursed)}
        description="Combined amount across supported assets"
      />
      <SummaryCard
        title="Recipients Reached"
        value={formatCount(stats.totalRecipients)}
        description="Unique verified recipients"
      />
    </div>
  );
}
