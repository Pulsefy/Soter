'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileWarning, Search, ShieldAlert } from 'lucide-react';
import {
  filterValidationRows,
  INITIAL_REPORT_PAGE_SIZE,
  REPORT_PAGE_INCREMENT,
  type ReportStatusFilter,
  type ValidationRowResult,
} from '@/lib/csv-validation';

interface ValidationReportPanelProps {
  rows: ValidationRowResult[];
  headers: string[];
}

const statusStyles = {
  valid:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  error:
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300',
} as const;

const FILTER_OPTIONS: Array<{ id: ReportStatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Errors' },
  { id: 'warning', label: 'Warnings' },
  { id: 'valid', label: 'Valid' },
];

function RowCard({ row, headers }: { row: ValidationRowResult; headers: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Row {row.rowNumber}</p>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusStyles[row.status]}`}
            >
              {row.status === 'valid' && <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              {row.status === 'warning' && <AlertTriangle className="mr-1 h-3.5 w-3.5" />}
              {row.status === 'error' && <ShieldAlert className="mr-1 h-3.5 w-3.5" />}
              {row.status}
            </span>
          </div>
          {row.messages.length > 0 ? (
            <ul className="space-y-2">
              {row.messages.map((message, index) => (
                <li
                  key={`${row.rowNumber}-${index}`}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    message.severity === 'error' ? statusStyles.error : statusStyles.warning
                  }`}
                >
                  <span className="font-medium">{message.field ? `${message.field}: ` : ''}</span>
                  {message.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">No issues detected for this row.</p>
          )}
        </div>

        <div className="min-w-0 flex-1 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            <FileWarning className="h-3.5 w-3.5" />
            Row values
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {headers.map(header => (
              <div key={`${row.rowNumber}-${header}`} className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{header}</p>
                <p className="truncate text-sm text-slate-700 dark:text-slate-200">{row.values[header] || '-'}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ValidationReportPanel({ rows, headers }: ValidationReportPanelProps) {
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('all');
  const [visibleCount, setVisibleCount] = useState(INITIAL_REPORT_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Debounce the search input so typing stays responsive on large reports.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput), 150);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filteredRows = useMemo(
    () => filterValidationRows(rows, query, statusFilter),
    [rows, query, statusFilter],
  );

  // Reset the window whenever the filtered set changes (state adjustment
  // during render, per the React docs pattern for derived resets).
  const filterKey = `${query}::${statusFilter}::${rows.length}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(INITIAL_REPORT_PAGE_SIZE);
  }

  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleCount),
    [filteredRows, visibleCount],
  );
  const remaining = Math.max(0, filteredRows.length - visibleRows.length);

  const statusCounts = useMemo(
    () => ({
      all: rows.length,
      error: rows.filter(row => row.status === 'error').length,
      warning: rows.filter(row => row.status === 'warning').length,
      valid: rows.filter(row => row.status === 'valid').length,
    }),
    [rows],
  );

  // Auto-load more rows as the operator scrolls towards the end of the list,
  // keeping large reports usable without rendering thousands of cards at once.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisibleCount(current =>
            current >= filteredRows.length ? current : current + REPORT_PAGE_INCREMENT,
          );
        }
      },
      { rootMargin: '240px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredRows.length]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Search by row number, message, field, or value…"
            aria-label="Search validation rows"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>

        <div
          role="group"
          aria-label="Filter rows by status"
          className="flex flex-wrap gap-2"
        >
          {FILTER_OPTIONS.map(option => {
            const isActive = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {option.label}
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {statusCounts[option.id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-slate-500 dark:text-slate-400">
        {filteredRows.length === rows.length
          ? `Showing ${visibleRows.length} of ${rows.length} row${rows.length === 1 ? '' : 's'}.`
          : `${filteredRows.length} matching row${filteredRows.length === 1 ? '' : 's'} — showing ${visibleRows.length}.`}
        {query.trim() && ' '}
        {query.trim() && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setQuery('');
            }}
            className="ml-1 font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            Clear search
          </button>
        )}
      </p>

      {visibleRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
          No rows match the current search and filters.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map(row => (
            <RowCard key={row.rowNumber} row={row} headers={headers} />
          ))}
        </div>
      )}

      {remaining > 0 && (
        <>
          <div ref={sentinelRef} aria-hidden="true" className="h-1 w-full" />
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setVisibleCount(current => current + REPORT_PAGE_INCREMENT)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Show more rows ({remaining} remaining)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
