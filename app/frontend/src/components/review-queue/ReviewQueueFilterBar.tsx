'use client';

import type { ReviewQueueFilters, RiskLevel, ReviewCaseStatus } from '@/types/review-case';

interface ReviewQueueFilterBarProps {
  filters: ReviewQueueFilters;
  onChange: (filters: ReviewQueueFilters) => void;
}

export function ReviewQueueFilterBar({ filters, onChange }: ReviewQueueFilterBarProps) {
  const handleStatusChange = (value: string) => {
    onChange({ ...filters, status: (value as ReviewCaseStatus) || undefined });
  };

  const handleRiskLevelChange = (value: string) => {
    onChange({ ...filters, riskLevel: (value as RiskLevel) || undefined });
  };

  const handleFromDateChange = (value: string) => {
    onChange({ ...filters, fromDate: value || undefined });
  };

  const handleToDateChange = (value: string) => {
    onChange({ ...filters, toDate: value || undefined });
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <label htmlFor="status-filter" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Status
        </label>
        <select
          id="status-filter"
          value={filters.status ?? ''}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="risk-filter" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Risk
        </label>
        <select
          id="risk-filter"
          value={filters.riskLevel ?? ''}
          onChange={(e) => handleRiskLevelChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">All</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="from-date" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          From
        </label>
        <input
          id="from-date"
          type="date"
          value={filters.fromDate ?? ''}
          onChange={(e) => handleFromDateChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="to-date" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          To
        </label>
        <input
          id="to-date"
          type="date"
          value={filters.toDate ?? ''}
          onChange={(e) => handleToDateChange(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>
    </div>
  );
}
