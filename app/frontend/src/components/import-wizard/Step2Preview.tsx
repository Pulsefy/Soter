'use client';

import type { RefObject } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, LoaderCircle, ShieldAlert } from 'lucide-react';
import type { CsvPreviewRow, HeaderValidationResult, ValidateProgress } from '@/lib/csv-validation';

interface Step2PreviewProps {
  file: File | null;
  headers: string[];
  previewRows: CsvPreviewRow[];
  totalRows: number;
  headerValidation: HeaderValidationResult | null;
  isValidating: boolean;
  validateProgress: ValidateProgress | null;
  canProceed: boolean;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onNext: () => void | Promise<void>;
}

export function Step2Preview({
  file,
  headers,
  previewRows,
  totalRows,
  headerValidation,
  isValidating,
  validateProgress,
  canProceed,
  headingRef,
  onBack,
  onNext,
}: Step2PreviewProps) {
  const hasColumnErrors = headerValidation && !headerValidation.valid;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-slate-900 dark:text-slate-50 focus:outline-none">Step 2: Preview recipient data</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Double-check the detected headers and the first rows from <span className="font-medium text-slate-900 dark:text-slate-100">{file?.name ?? 'your file'}</span> before validation runs.
        </p>
      </div>

      {hasColumnErrors && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4" />
            Column validation
          </div>
          <ul className="space-y-2">
            {headerValidation!.errors.map((err, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{err.message}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Fix these columns in your CSV and re-upload, or proceed with validation (missing columns will produce row-level errors).
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rows detected</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{totalRows}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Columns detected</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{headers.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Rows shown</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{previewRows.length}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-950">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">Row</th>
                {headers.map(header => (
                  <th key={header} className="px-4 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
              {previewRows.map(row => (
                <tr key={row.index}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{row.index}</td>
                  {headers.map(header => (
                    <td key={`${row.index}-${header}`} className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {row.values[header] || <span className="text-slate-400 dark:text-slate-500">-</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalRows > previewRows.length && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Showing the first {previewRows.length} rows. Full-file validation will still run across all {totalRows} rows.
        </p>
      )}

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
          onClick={() => void onNext()}
          disabled={!canProceed || isValidating}
          className="inline-flex min-w-32 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isValidating ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {validateProgress
                ? `Validating: ${validateProgress.rowsValidated} / ${validateProgress.totalRows}`
                : 'Validating...'}
            </>
          ) : (
            <>
              Validate rows
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
