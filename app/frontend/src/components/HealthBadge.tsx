'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useHealthStatus } from '@/hooks/useHealthStatus';
import type { HealthState } from '@/types/health';

/* ─── Colours & labels ──────────────────────────────────────────────────── */

interface StateConfig {
  color: string;
  label: string;
  bars: number;
}

const STATE_CONFIG: Record<HealthState, StateConfig> = {
  ok: {
    color: 'text-green-400',
    label: 'Healthy',
    bars: 4,
  },
  degraded: {
    color: 'text-yellow-400',
    label: 'Degraded',
    bars: 2,
  },
  down: {
    color: 'text-red-500',
    label: 'Down',
    bars: 1,
  },
  loading: {
    color: 'text-gray-500 animate-pulse',
    label: 'Checking…',
    bars: 4,
  },
};

/* ─── Popover detail row ────────────────────────────────────────────────── */

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className="text-gray-200 font-mono truncate max-w-45">{value}</span>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */

export const HealthBadge: React.FC = () => {
  const { state, data, error, lastChecked } = useHealthStatus();
  const config = STATE_CONFIG[state];

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const lastCheckedStr = lastChecked ? lastChecked.toLocaleTimeString() : '—';

  return (
    <div ref={containerRef} className="relative flex items-center">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={`Backend status: ${config.label}`}
        aria-expanded={open}
        className="group relative flex items-end gap-1 p-2 rounded-md hover:bg-gray-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-600"
        title={`Backend: ${config.label}`}
      >
        {[1, 2, 3, 4].map(barIndex => {
          const heightClass =
            barIndex === 1
              ? 'h-1.5'
              : barIndex === 2
                ? 'h-2.5'
                : barIndex === 3
                  ? 'h-3.5'
                  : 'h-5';

          const isActive = barIndex <= config.bars;

          return (
            <div
              key={barIndex}
              className={`w-1.5 rounded-sm ${heightClass} ${
                isActive ? `${config.color} bg-current` : 'bg-gray-700'
              }`}
            />
          );
        })}
      </button>

      {/* ── Detail popover ── */}
      {open && (
        <div
          role="tooltip"
          className="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-gray-700 bg-gray-900 shadow-2xl p-4 space-y-2.5"
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`h-2.5 w-2.5 rounded-full bg-current ${config.color} shrink-0`}
            />
            <span className="font-semibold text-sm text-white">
              Backend Health
            </span>
          </div>

          <hr className="border-gray-700" />

          {/* Details */}
          {data ? (
            <div className="space-y-1.5">
              <DetailRow label="Status" value={data.status} />
              <DetailRow label="Service" value={data.service} />
              <DetailRow label="Version" value={data.version} />
              <DetailRow label="Environment" value={data.environment} />
              <DetailRow
                label="Server time"
                value={
                  data.timestamp
                    ? new Date(data.timestamp).toLocaleTimeString()
                    : null
                }
              />
            </div>
          ) : error ? (
            <p className="text-xs text-red-400 wrap-break-word">
              {error.message || 'Could not reach the backend.'}
            </p>
          ) : (
            <p className="text-xs text-gray-400">Fetching status…</p>
          )}

          <hr className="border-gray-700" />

          <p className="text-[11px] text-gray-500">
            Last checked: {lastCheckedStr}
          </p>
        </div>
      )}
    </div>
  );
};
