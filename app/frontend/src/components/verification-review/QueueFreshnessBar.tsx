'use client';

/**
 * QueueFreshnessBar
 *
 * Shows:
 *  - Last refresh timestamp ("Updated 12 seconds ago" / exact time when stale)
 *  - Animated spinner while a background refetch is in progress
 *  - Refresh latency badge (e.g. "142 ms")
 *  - Error state when the last fetch failed
 *  - Manual "Refresh" button
 *
 * Designed to be placed above or below the ReviewQueue list so reviewers
 * always know how fresh their view is.
 */

import React, { useEffect, useState } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { QueueRefreshStatus } from '@/hooks/useVerificationInbox';

interface QueueFreshnessBarProps {
  status: QueueRefreshStatus;
  /** Auto-refresh interval in ms (informational only, used to decide "stale" threshold) */
  autoRefreshMs?: number;
}

/** Format a duration as a short human-readable string. */
function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** Format an exact time as HH:MM:SS. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Format latency with appropriate precision. */
function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function QueueFreshnessBar({
  status,
  autoRefreshMs = 30_000,
}: QueueFreshnessBarProps) {
  const { lastRefreshedAt, isRefreshing, latencyMs, hasError, refresh } = status;

  // Tick every second to keep the relative timestamp live
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageMs = lastRefreshedAt > 0 ? now - lastRefreshedAt : null;
  // Consider data stale when it's older than 1.5× the auto-refresh interval
  const isStale = ageMs !== null && ageMs > autoRefreshMs * 1.5;
  const neverFetched = lastRefreshedAt === 0;

  // ── Derive status label ───────────────────────────────────────────────────

  let statusIcon: React.ReactNode;
  let statusLabel: string;
  let statusClass: string;

  if (isRefreshing) {
    statusIcon = (
      <RefreshCw
        size={13}
        className="animate-spin text-blue-500 dark:text-blue-400"
        aria-hidden="true"
      />
    );
    statusLabel = 'Refreshing…';
    statusClass = 'text-blue-600 dark:text-blue-400';
  } else if (hasError) {
    statusIcon = (
      <WifiOff size={13} className="text-red-500 dark:text-red-400" aria-hidden="true" />
    );
    statusLabel = 'Refresh failed';
    statusClass = 'text-red-600 dark:text-red-400';
  } else if (neverFetched) {
    statusIcon = (
      <Clock size={13} className="text-gray-400 dark:text-gray-500" aria-hidden="true" />
    );
    statusLabel = 'Loading…';
    statusClass = 'text-gray-500 dark:text-gray-400';
  } else if (isStale) {
    statusIcon = (
      <AlertTriangle
        size={13}
        className="text-amber-500 dark:text-amber-400"
        aria-hidden="true"
      />
    );
    statusLabel = `Stale — updated ${formatAge(ageMs!)} (${formatTime(lastRefreshedAt)})`;
    statusClass = 'text-amber-600 dark:text-amber-400';
  } else {
    statusIcon = (
      <CheckCircle2
        size={13}
        className="text-green-500 dark:text-green-400"
        aria-hidden="true"
      />
    );
    statusLabel =
      ageMs !== null
        ? `Updated ${formatAge(ageMs)} (${formatTime(lastRefreshedAt)})`
        : 'Up to date';
    statusClass = 'text-green-700 dark:text-green-400';
  }

  // ── Connection pill ───────────────────────────────────────────────────────

  const connectionPill = hasError ? (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
      title="Last refresh attempt failed — data may be outdated"
    >
      <WifiOff size={10} aria-hidden="true" />
      Offline
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
      title="Connected — data is being refreshed automatically"
    >
      <Wifi size={10} aria-hidden="true" />
      Live
    </span>
  );

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
        hasError
          ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
          : isStale
            ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
            : 'bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-700'
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Queue freshness: ${statusLabel}`}
    >
      {/* Left: icon + status text + connection pill */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`flex items-center gap-1 font-medium ${statusClass}`}>
          {statusIcon}
          <span>{statusLabel}</span>
        </span>

        {connectionPill}

        {/* Latency badge */}
        {latencyMs !== null && !neverFetched && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
            title={`Last refresh took ${formatLatency(latencyMs)}`}
            aria-label={`Last fetch latency: ${formatLatency(latencyMs)}`}
          >
            <Clock size={10} aria-hidden="true" />
            {formatLatency(latencyMs)}
          </span>
        )}
      </div>

      {/* Right: refresh button */}
      <button
        onClick={refresh}
        disabled={isRefreshing}
        aria-label="Manually refresh the review queue"
        className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[11px] font-medium"
      >
        <RefreshCw
          size={11}
          className={isRefreshing ? 'animate-spin' : ''}
          aria-hidden="true"
        />
        Refresh
      </button>
    </div>
  );
}
