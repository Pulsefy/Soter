'use client';

import { Activity, FlaskConical } from 'lucide-react';

export type DemoModeType = 'fixture' | 'deterministic' | 'live';

interface DemoModeBannerProps {
  /**
   * The demo mode level reported by the AI service or forced via env.
   * - `fixture`       — TEST_PROVIDER_MODE is active; responses come from fixture files, no API keys used.
   * - `deterministic` — AI_DETERMINISTIC_MODE is active; outputs are hardcoded stable values.
   * - `live`          — real backend/provider is in use.
   */
  mode: DemoModeType;
}

const MODE_COPY: Record<
  Exclude<DemoModeType, 'live'>,
  { title: string; description: string }
> = {
  fixture: {
    title: 'Demo mode — fixture data active',
    description:
      'AI responses are served from local fixture files. No API keys are used. ' +
      'Set TEST_PROVIDER_MODE=false and supply an API key to switch to live inference.',
  },
  deterministic: {
    title: 'Degraded mode — deterministic output active',
    description:
      'AI inference is returning hardcoded deterministic results. ' +
      'Live AI calls are disabled. Set AI_DETERMINISTIC_MODE=false to restore live inference.',
  },
};

/**
 * Persistent data-provenance indicator.
 *
 * It is deliberately NON-DISMISSIBLE: contributors and testers can always tell
 * whether the page is backed by live backend data or by demo fixtures, and the
 * notice cannot be hidden for the remainder of the session.
 *
 * The campaigns and aid-package hooks surface their provenance through this
 * same indicator: they call the real API client (`@/lib/api-client`), so they
 * render the `live` state instead of the demo/fixture states.
 */
export function DemoModeBanner({ mode }: DemoModeBannerProps) {
  if (mode === 'live') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-emerald-950/60 border-b border-emerald-500/30"
      >
        <div className="max-w-7xl mx-auto px-4 py-1.5">
          <div className="flex items-center gap-2">
            <Activity
              size={14}
              className="text-emerald-400"
              aria-hidden="true"
            />
            <p className="text-xs font-medium text-emerald-200">
              Live backend data
            </p>
          </div>
        </div>
      </div>
    );
  }

  const copy = MODE_COPY[mode];

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-indigo-950/80 border-b border-indigo-500/40"
    >
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-800/60 text-indigo-300"
            aria-hidden="true"
          >
            <FlaskConical size={18} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-200">{copy.title}</p>
            <p className="mt-0.5 text-xs text-indigo-300/80">{copy.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
