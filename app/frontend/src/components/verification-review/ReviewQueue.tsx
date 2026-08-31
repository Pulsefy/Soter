'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { StatusBadge, RiskBadge } from './StatusBadge';
import { VerificationDetailPanel } from './VerificationDetailPanel';
import { QueueFreshnessBar } from './QueueFreshnessBar';
import {
  useInboxWithLatency,
  useQueueRefreshStatus,
  useOptimisticItemState,
} from '@/hooks/useVerificationInbox';
import type { ReviewFilters, RiskLevel } from '@/types/verification-review';

interface ReviewQueueProps {
  filters: ReviewFilters;
  onPageChange: (page: number) => void;
}

export function ReviewQueue({ filters, onPageChange }: ReviewQueueProps) {
  const { data, isLoading, isError, error, isFetching } = useInboxWithLatency(filters);
  const refreshStatus = useQueueRefreshStatus(filters);
  const { pendingIds, failedIds } = useOptimisticItemState();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Initial hard load (no cached data yet)
  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        {/* Show a placeholder freshness bar while loading */}
        <div className="h-8 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="space-y-3">
        <div className="p-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
          Failed to load queue: {(error as Error).message}
        </div>
        <button
          onClick={refreshStatus.refresh}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="space-y-3">
        <QueueFreshnessBar status={refreshStatus} />
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500 gap-3">
          <Inbox size={36} strokeWidth={1.5} />
          <p className="text-sm">
            No verification cases match the current filters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Freshness bar ─────────────────────────────────────────────── */}
      <QueueFreshnessBar status={refreshStatus} />

      {/* ── Background-refetch shimmer on the list ────────────────────── */}
      {isFetching && !isLoading && (
        <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          <span>Syncing…</span>
        </div>
      )}

      <div className="flex gap-4 min-h-0">
        {/* ── Queue list ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-2">
          {data.items.map(item => {
            const isItemPending = pendingIds.has(item.id);
            const isItemFailed = failedIds.has(item.id);

            return (
              <button
                key={item.id}
                onClick={() =>
                  setSelectedId(item.id === selectedId ? null : item.id)
                }
                disabled={isItemPending}
                aria-busy={isItemPending}
                aria-label={`Verification ${item.id}${isItemPending ? ' — action in progress' : ''}${isItemFailed ? ' — action failed' : ''}`}
                className={[
                  'w-full text-left px-4 py-3 rounded-lg border transition-colors relative',
                  isItemPending
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/15 cursor-wait opacity-85'
                    : isItemFailed
                      ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/15'
                      : selectedId === item.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-200 dark:hover:border-gray-700',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-mono text-xs text-gray-400 dark:text-gray-500 truncate max-w-[140px]">
                      {item.id}
                    </span>
                    <StatusBadge status={item.status} />
                    {item.riskLevel && (
                      <RiskBadge level={item.riskLevel as RiskLevel} />
                    )}

                    {/* Pending spinner */}
                    {isItemPending && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        title="Action in progress…"
                      >
                        <Loader2
                          size={10}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                        Saving…
                      </span>
                    )}

                    {/* Failed badge */}
                    {isItemFailed && !isItemPending && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                        title="Action failed — data has been rolled back"
                        role="alert"
                      >
                        <AlertCircle size={10} aria-hidden="true" />
                        Failed
                      </span>
                    )}
                  </div>

                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                    {format(new Date(item.createdAt), 'dd MMM yyyy')}
                  </span>
                </div>

                {item.nextStepMessage && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                    {item.nextStepMessage}
                  </p>
                )}

                {/* Failed retry hint */}
                {isItemFailed && !isItemPending && (
                  <p
                    className="mt-1 text-xs text-red-500 dark:text-red-400"
                    role="alert"
                  >
                    Action failed — please try again.
                  </p>
                )}
              </button>
            );
          })}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Page {data.page} of {data.totalPages} · {data.total} total
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => onPageChange(data.page - 1)}
                  disabled={data.page <= 1}
                  aria-label="Previous page"
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => onPageChange(data.page + 1)}
                  disabled={data.page >= data.totalPages}
                  aria-label="Next page"
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div className="w-80 shrink-0 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col">
            <VerificationDetailPanel
              verificationId={selectedId}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}