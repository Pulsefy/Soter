'use client';

import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, FileWarning, ShieldAlert } from 'lucide-react';
import type { ValidationResult } from '@/lib/csv-validation';

interface Step3ValidationProps {
  result: ValidationResult;
  headers: string[];
  isValidating: boolean;
  canProceed: boolean;
  onBack: () => void;
  onNext: () => void;
  onDownloadReport: () => void;
}

const statusStyles = {
  valid: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
  error: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300',
} as const;

export function Step3Validation({
  result,
  headers,
  isValidating,
  canProceed,
  onBack,
  onNext,
  onDownloadReport,
}: Step3ValidationProps) {
  const hasBlockingErrors = result.summary.errorRows > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Step 3: Resolve validation issues</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Review row-level warnings and errors before final confirmation. Errors block import until the source file is corrected and re-uploaded.
          </p>
        </div>

        <button
          type="button"
          onClick={onDownloadReport}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Download className="h-4 w-4" />
          Download report
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Total rows</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{result.summary.totalRows}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <p className="text-xs uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Valid</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-800 dark:text-emerald-200">{result.summary.validRows}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-xs uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Warnings</p>
          <p className="mt-2 text-2xl font-semibold text-amber-800 dark:text-amber-200">{result.summary.warningRows}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
          <p className="text-xs uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">Errors</p>
          <p className="mt-2 text-2xl font-semibold text-rose-800 dark:text-rose-200">{result.summary.errorRows}</p>
        </div>
      </div>

      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          hasBlockingErrors
            ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
        }`}
      >
        {hasBlockingErrors
          ? 'Some rows still have blocking errors. Download the report, correct the CSV, then upload the revised file to continue.'
          : 'No blocking errors remain. You can continue to final confirmation.'}
      </div>

      <div className="space-y-3">
        {result.rows.map(row => (
          <div key={row.rowNumber} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Row {row.rowNumber}</p>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusStyles[row.status]}`}>
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
                        className={`rounded-lg border px-3 py-2 text-sm ${message.severity === 'error' ? statusStyles.error : statusStyles.warning}`}
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
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isValidating}
          className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed || hasBlockingErrors}
          className="inline-flex min-w-32 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
