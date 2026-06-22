'use client';

import { ChangeEvent } from 'react';
import { FileText, LoaderCircle, UploadCloud } from 'lucide-react';

interface Step1UploadProps {
  file: File | null;
  fileError: string | null;
  isParsing: boolean;
  canProceed: boolean;
  onFileSelected: (file: File | null) => void | Promise<void>;
  onNext: () => void;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function Step1Upload({ file, fileError, isParsing, canProceed, onFileSelected, onNext }: Step1UploadProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    void onFileSelected(nextFile);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Step 1: Upload recipient file</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Choose a CSV export from your recipient system. We&apos;ll parse the file locally first so you can inspect the shape before anything is submitted.
        </p>
      </div>

      <label className="block rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 transition hover:border-blue-500 hover:bg-blue-50/40 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-blue-500 dark:hover:bg-blue-950/20">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400">
            <UploadCloud className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-50">Upload CSV file</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Accepted format: `.csv`</p>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleChange}
            className="block w-full max-w-sm cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
        </div>
      </label>

      {file && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{file.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(file.size)}</p>
            </div>
          </div>
          {isParsing && (
            <div className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Parsing file...
            </div>
          )}
        </div>
      )}

      {fileError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          {fileError}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Recommended columns</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          `name`, `wallet`, and `phone` are recognized automatically. Extra columns will be preserved in the preview and included in validation payloads.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed || isParsing}
          className="inline-flex min-w-28 items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
