'use client';

import React, { useCallback, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { StatsBar } from '@/components/verification-review/StatsBar';
import { ReviewFiltersBar } from '@/components/verification-review/ReviewFiltersBar';
import { ReviewQueue } from '@/components/verification-review/ReviewQueue';
import type { ReviewFilters } from '@/types/verification-review';

const DEFAULT_FILTERS: ReviewFilters = {
  status: '',
  riskLevel: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
};

export default function VerificationReviewPage() {
  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_FILTERS);

  const handleFilterChange = useCallback((patch: Partial<ReviewFilters>) => {
    setFilters(prev => ({ ...prev, ...patch }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setFilters(prev => ({ ...prev, page }));
  }, []);

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-gray-50 dark:to-gray-950">
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <ShieldCheck
                  size={20}
                  className="text-blue-600 dark:text-blue-400"
                />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Verification Review
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Manual review queue for flagged verification cases
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <StatsBar />

          {/* Filters */}
          <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            <ReviewFiltersBar filters={filters} onChange={handleFilterChange} />
          </div>

          {/* Queue */}
          <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            <ReviewQueue filters={filters} onPageChange={handlePageChange} />
          </div>
        </div>
      </main>
    </div>
  );
}
