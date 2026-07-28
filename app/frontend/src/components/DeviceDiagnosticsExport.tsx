'use client';

import React, { useState, useEffect } from 'react';
import {
  generateDeviceDiagnostics,
  SupportDiagnosticsBundle,
} from '@/lib/diagnostics';

export function DeviceDiagnosticsExport() {
  const [diagnostics, setDiagnostics] = useState<SupportDiagnosticsBundle | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [showJsonPreview, setShowJsonPreview] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const fetchDiagnostics = async () => {
    setLoading(true);
    try {
      const data = await generateDeviceDiagnostics();
      setDiagnostics(data);
    } catch {
      // Fallback handled in generateDeviceDiagnostics
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!diagnostics) return;
    const jsonString = JSON.stringify(diagnostics, null, 2);

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(jsonString);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = jsonString;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error('Failed to copy diagnostics bundle:', err);
    }
  };

  const handleDownload = () => {
    if (!diagnostics) return;
    const jsonString = JSON.stringify(diagnostics, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const formattedTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `soter-diagnostics-${formattedTimestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">
              Support & Device Diagnostics Export
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Export sanitized application state, wallet status, queue metrics, and error logs to share with support.
          </p>
        </div>

        <button
          onClick={fetchDiagnostics}
          disabled={loading}
          className="self-start text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {loading ? 'Refreshing...' : '🔄 Refresh Diagnostics'}
        </button>
      </div>

      {/* Privacy Notice */}
      <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
        <div className="flex items-start gap-3">
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <div className="text-xs leading-relaxed">
            <span className="font-semibold">Privacy Protected:</span> All secret keys, seed phrases, access tokens, passwords, and personal identifiers are automatically scrubbed and redacted before output (`[REDACTED]`).
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="ml-3 text-sm text-slate-500">Collecting diagnostics state...</span>
        </div>
      ) : diagnostics ? (
        <div className="mt-6 space-y-6">
          {/* Diagnostic Metrics Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                App Metadata
              </span>
              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                v{diagnostics.appVersion} ({diagnostics.environment})
              </p>
              <p className="mt-0.5 text-xs text-slate-500 truncate" title={diagnostics.timestamp}>
                {new Date(diagnostics.timestamp).toLocaleTimeString()}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Wallet & Network
              </span>
              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                {diagnostics.clientState.wallet.connected ? 'Connected' : 'Disconnected'}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Net: {diagnostics.clientState.wallet.network || 'Testnet'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Queue Health
              </span>
              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                {diagnostics.queueHealth ? 'Active / Checked' : 'Unavailable'}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Mock Mode: {diagnostics.clientState.mockMode ? 'Enabled' : 'Disabled'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Recent Errors Logged
              </span>
              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                {diagnostics.recentErrors.length} entries
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Status: Sanitized
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 active:scale-95 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copied ? '✅ Copied to Clipboard!' : 'Copy Diagnostics JSON'}
            </button>

            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-750"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {downloadSuccess ? '✅ Downloaded!' : 'Download JSON Bundle'}
            </button>

            <button
              onClick={() => setShowJsonPreview(!showJsonPreview)}
              className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {showJsonPreview ? 'Hide Raw JSON' : 'Preview Raw JSON'}
            </button>
          </div>

          {/* JSON Preview Accordion */}
          {showJsonPreview && (
            <div className="relative mt-4 rounded-xl border border-slate-200 bg-slate-950 p-4 text-xs font-mono text-slate-200 dark:border-slate-800">
              <div className="mb-2 flex justify-between border-b border-slate-800 pb-2 text-slate-400">
                <span>Sanitized Diagnostics Bundle Preview</span>
                <span>JSON</span>
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-emerald-400">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
