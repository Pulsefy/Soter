'use client';

import React, { useCallback, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StatsBar } from '@/components/verification-review/StatsBar';
import { ReviewFiltersBar } from '@/components/verification-review/ReviewFiltersBar';
import { ReviewFilterPresets } from '@/components/verification-review/ReviewFilterPresets';
import { ReviewQueue } from '@/components/verification-review/ReviewQueue';
import type { ReviewFilters, VerificationStatus, RiskLevel } from '@/types/verification-review';

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS: ReviewFilters = {
  status: '',
  riskLevel: '',
  campaignId: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
};

// ── URL ↔ state helpers ───────────────────────────────────────────────────────

function filtersFromParams(params: URLSearchParams): ReviewFilters {
  return {
    status: (params.get('status') ?? '') as VerificationStatus | '',
    riskLevel: (params.get('riskLevel') ?? '') as RiskLevel | '',
    campaignId: params.get('campaignId') ?? '',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    page: Number(params.get('page') ?? 1),
  };
}

function filtersToParams(filters: ReviewFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.riskLevel) p.set('riskLevel', filters.riskLevel);
  if (filters.campaignId) p.set('campaignId', filters.campaignId);
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) p.set('dateTo', filters.dateTo);
  if (filters.page > 1) p.set('page', String(filters.page));
  return p;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VerificationReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Derive current filters from the URL on every render
  const filters = filtersFromParams(searchParams);

  // Push a new URL whenever filters change
  const applyFilters = useCallback(
    (patch: Partial<ReviewFilters>) => {
      const next: ReviewFilters = { ...filters, ...patch };
      const qs = filtersToParams(next).toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, router],
  );

  const handlePageChange = useCallback(
    (page: number) => applyFilters({ page }),
    [applyFilters],
  );

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

          {/* Filters + Saved Views */}
          <div className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-4">
            <ReviewFiltersBar filters={filters} onChange={applyFilters} />
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <ReviewFilterPresets filters={filters} onApply={applyFilters} />
            </div>
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
