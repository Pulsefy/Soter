'use client';

import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import type { CsvPreviewRow } from '@/lib/csv-validation';

interface Step2PreviewProps {
  file: File | null;
  headers: string[];
  previewRows: CsvPreviewRow[];
  totalRows: number;
  isValidating: boolean;
  canProceed: boolean;
  onBack: () => void;
  onNext: () => void | Promise<void>;
}

export function Step2Preview({
  file,
  headers,
  previewRows,
  totalRows,
  isValidating,
  canProceed,
  onBack,
  onNext,
}: Step2PreviewProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Step 2: Preview recipient data</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Double-check the detected headers and the first rows from <span className="font-medium text-slate-900 dark:text-slate-100">{file?.name ?? 'your file'}</span> before validation runs.
        </p>
      </div>

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
          className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
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
              Validating...
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
