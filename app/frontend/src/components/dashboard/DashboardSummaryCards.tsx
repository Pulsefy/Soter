'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type DashboardSummary = {
  totalClaims: number;
  totalPackages: number;
  pendingReviews: number;
  totalDisbursements: number;
};

type SummaryMetric = {
  title: string;
  value: number;
  emptyDescription: string;
  description: string;
};

async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const response = await fetchClient(`${API_URL}/analytics/global-stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard summary: ${response.status}`);
  }

  const data = (await response.json()) as Partial<DashboardSummary>;
  const values = [
    data.totalClaims,
    data.totalPackages,
    data.pendingReviews,
    data.totalDisbursements,
  ];

  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Dashboard summary response is incomplete');
  }

  return data as DashboardSummary;
}

function StatCard({ metric, isLoading, isError }: {
  metric: SummaryMetric;
  isLoading: boolean;
  isError: boolean;
}) {
  const description = isError
    ? 'Live metric is temporarily unavailable'
    : isLoading
      ? 'Loading live metric'
      : metric.value === 0
        ? metric.emptyDescription
        : metric.description;

  return (
    <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800" aria-live="polite">
      <h3 className="text-lg font-semibold mb-2">{metric.title}</h3>
      <p className="text-3xl font-bold">
        {isError ? 'Unavailable' : isLoading ? '-' : metric.value.toLocaleString()}
      </p>
      <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">{description}</p>
    </div>
  );
}

export function DashboardSummaryCards() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', 'global-stats'],
    queryFn: fetchDashboardSummary,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const metrics: SummaryMetric[] = [
    {
      title: 'Claims',
      value: data?.totalClaims ?? 0,
      description: 'Total claims recorded',
      emptyDescription: 'No claims recorded yet',
    },
    {
      title: 'Packages',
      value: data?.totalPackages ?? 0,
      description: 'Aid packages created',
      emptyDescription: 'No aid packages created yet',
    },
    {
      title: 'Reviews Pending',
      value: data?.pendingReviews ?? 0,
      description: 'Awaiting verification review',
      emptyDescription: 'No reviews awaiting action',
    },
    {
      title: 'Disbursements',
      value: data?.totalDisbursements ?? 0,
      description: 'Claims disbursed',
      emptyDescription: 'No disbursements recorded yet',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {metrics.map(metric => (
        <StatCard key={metric.title} metric={metric} isLoading={isLoading} isError={isError} />
      ))}
    </div>
  );
}
