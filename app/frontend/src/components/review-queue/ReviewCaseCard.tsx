'use client';

import type { ReviewCase, RiskLevel } from '@/types/review-case';

interface ReviewCaseCardProps {
  reviewCase: ReviewCase;
  isSelected: boolean;
  onClick: () => void;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const styles = {
    low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[level]}`}
    >
      {level.charAt(0).toUpperCase() + level.slice(1)} Risk
    </span>
  );
}

function StatusBadge({ status }: { status: ReviewCase['status'] }) {
  const styles = {
    pending: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function ReviewCaseCard({ reviewCase, isSelected, onClick }: ReviewCaseCardProps) {
  const claim = reviewCase.claim;
  const formattedDate = new Date(reviewCase.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-200 ${
        isSelected
          ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate">
              Claim {claim.id.slice(0, 8)}…
            </h3>
            <StatusBadge status={reviewCase.status} />
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {claim.campaign.name} · {claim.recipientRef}
          </p>
        </div>
        <RiskBadge level={reviewCase.riskLevel} />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>Score: {(reviewCase.aiScore * 100).toFixed(0)}%</span>
          <span>Confidence: {(reviewCase.confidence * 100).toFixed(0)}%</span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">{formattedDate}</span>
      </div>

      {reviewCase.evidenceSummary && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
          {reviewCase.evidenceSummary}
        </p>
      )}
    </button>
  );
}
