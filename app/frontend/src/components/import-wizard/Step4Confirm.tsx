'use client';

import { AlertCircle, CheckCircle2, ChevronLeft, LoaderCircle, RefreshCcw } from 'lucide-react';
import type { ValidationResult } from '@/lib/csv-validation';

interface Step4ConfirmProps {
  result: ValidationResult;
  isSubmitting: boolean;
  hasBlockingErrors: boolean;
  submitMessage: string | null;
  submitError: string | null;
  onBack: () => void;
  onConfirm: () => void | Promise<void>;
  onStartOver: () => void;
}

export function Step4Confirm({
  result,
  isSubmitting,
  hasBlockingErrors,
  submitMessage,
  submitError,
  onBack,
  onConfirm,
  onStartOver,
}: Step4ConfirmProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Step 4: Confirm import</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Review the summary below, then submit the validated recipient list to complete the import.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <p className="text-xs uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Valid recipients</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-900 dark:text-emerald-100">{result.summary.validRows}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-xs uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Warnings</p>
          <p className="mt-2 text-3xl font-semibold text-amber-900 dark:text-amber-100">{result.summary.warningRows}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-900/50 dark:bg-rose-950/30">
          <p className="text-xs uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">Errors</p>
          <p className="mt-2 text-3xl font-semibold text-rose-900 dark:text-rose-100">{result.summary.errorRows}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950">
        <p className="text-base font-medium text-slate-900 dark:text-slate-100">
          {result.summary.validRows} recipient{result.summary.validRows === 1 ? '' : 's'} ready, {result.summary.errorRows} row
          {result.summary.errorRows === 1 ? '' : 's'} blocked.
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Warnings do not block submission, but they are worth reviewing. Errors must be resolved before the import can proceed.
        </p>
      </div>

      {submitMessage && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{submitMessage}</p>
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{submitError}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onStartOver}
            className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCcw className="h-4 w-4" />
            Start over
          </button>

          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isSubmitting || hasBlockingErrors || Boolean(submitMessage)}
            className="inline-flex min-w-40 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              'Confirm import'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
