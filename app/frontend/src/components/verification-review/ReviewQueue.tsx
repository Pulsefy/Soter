'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { StatusBadge, RiskBadge } from './StatusBadge';
import { VerificationDetailPanel } from './VerificationDetailPanel';
import { useInbox } from '@/hooks/useVerificationInbox';
import type { ReviewFilters, RiskLevel } from '@/types/verification-review';

interface ReviewQueueProps {
  filters: ReviewFilters;
  onPageChange: (page: number) => void;
}

export function ReviewQueue({ filters, onPageChange }: ReviewQueueProps) {
  const { data, isLoading, isError, error } = useInbox(filters);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
        Failed to load queue: {(error as Error).message}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500 gap-3">
        <Inbox size={36} strokeWidth={1.5} />
        <p className="text-sm">
          No verification cases match the current filters.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 min-h-0">
      {/* List */}
      <div className="flex-1 min-w-0 space-y-2">
        {data.items.map(item => (
          <button
            key={item.id}
            onClick={() =>
              setSelectedId(item.id === selectedId ? null : item.id)
            }
            className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
              selectedId === item.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-200 dark:hover:border-gray-700'
            }`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-gray-400 dark:text-gray-500 truncate max-w-[140px]">
                  {item.id}
                </span>
                <StatusBadge status={item.status} />
                {item.riskLevel && (
                  <RiskBadge level={item.riskLevel as RiskLevel} />
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
          </button>
        ))}

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
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => onPageChange(data.page + 1)}
                disabled={data.page >= data.totalPages}
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
  );
}
