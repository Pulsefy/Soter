'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useReviewQueue, useReviewCase } from '@/hooks/useReviewQueue';
import { ReviewCaseCard } from '@/components/review-queue/ReviewCaseCard';
import { ReviewQueueFilterBar } from '@/components/review-queue/ReviewQueueFilterBar';
import { ReviewCaseDetailPanel } from '@/components/review-queue/ReviewCaseDetailPanel';
import type { ReviewQueueFilters } from '@/types/review-case';
import { ShieldAlert, Loader2 } from 'lucide-react';

function ReviewQueueContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const urlStatus = searchParams.get('status') ?? '';
  const urlRiskLevel = searchParams.get('riskLevel') ?? '';
  const urlFromDate = searchParams.get('fromDate') ?? '';
  const urlToDate = searchParams.get('toDate') ?? '';
  const urlSelectedId = searchParams.get('selected') ?? '';

  const [filters, setFilters] = useState<ReviewQueueFilters>({
    status: urlStatus as ReviewQueueFilters['status'],
    riskLevel: urlRiskLevel as ReviewQueueFilters['riskLevel'],
    fromDate: urlFromDate || undefined,
    toDate: urlToDate || undefined,
  });

  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useReviewQueue({ ...filters, page, limit: 20 });
  const { data: selectedCase } = useReviewCase(urlSelectedId || null);

  function updateUrlParams(newFilters: ReviewQueueFilters, selectedId?: string) {
    const params = new URLSearchParams();
    if (newFilters.status) params.set('status', newFilters.status);
    if (newFilters.riskLevel) params.set('riskLevel', newFilters.riskLevel);
    if (newFilters.fromDate) params.set('fromDate', newFilters.fromDate);
    if (newFilters.toDate) params.set('toDate', newFilters.toDate);
    if (selectedId) params.set('selected', selectedId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function handleFilterChange(newFilters: ReviewQueueFilters) {
    setFilters(newFilters);
    setPage(1);
    updateUrlParams(newFilters, urlSelectedId || undefined);
  }

  function handleSelectCase(id: string) {
    updateUrlParams(filters, id);
  }

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Review Queue</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Manually review claims flagged by the AI verification system.
          </p>
        </div>

        <div className="mb-4 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <ReviewQueueFilterBar filters={filters} onChange={handleFilterChange} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Case List */}
          <div className="lg:col-span-1 flex flex-col gap-3">
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5" />
                  <p>{error.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-2 text-sm font-medium underline hover:no-underline"
                >
                  Retry
                </button>
              </div>
            )}

            {!isLoading && !error && data?.items.length === 0 && (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No cases match the current filters.</p>
              </div>
            )}

            {data?.items.map((item) => (
              <ReviewCaseCard
                key={item.id}
                reviewCase={item}
                isSelected={item.id === urlSelectedId}
                onClick={() => handleSelectCase(item.id)}
              />
            ))}

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 min-h-[500px]">
            <ReviewCaseDetailPanel
              reviewCase={selectedCase ?? null}
              onActionComplete={() => {
                // Optionally deselect or refresh
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function Fallback() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <Loader2 className="w-10 h-10 animate-spin text-gray-400" />
    </div>
  );
}

export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ReviewQueueContent />
    </Suspense>
  );
}
