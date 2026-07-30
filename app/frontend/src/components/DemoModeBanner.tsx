'use client';

import { FlaskConical, X } from 'lucide-react';
import { useState } from 'react';

export type DemoModeType = 'fixture' | 'deterministic' | 'live';

interface DemoModeBannerProps {
  /**
   * The demo mode level reported by the AI service or forced via env.
   * - `fixture`       — TEST_PROVIDER_MODE is active; responses come from fixture files, no API keys used.
   * - `deterministic` — AI_DETERMINISTIC_MODE is active; outputs are hardcoded stable values.
   * - `live`          — real AI provider is in use (banner is hidden).
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
 * Visible banner that tells contributors and testers they are NOT seeing live
 * AI data. Only rendered when `mode` is `fixture` or `deterministic`.
 *
 * Dismissible per session (state is local — banner reappears on page refresh
 * so it cannot be silently forgotten).
 */
export function DemoModeBanner({ mode }: DemoModeBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (mode === 'live' || isDismissed) return null;

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

          <button
            onClick={() => setIsDismissed(true)}
            className="shrink-0 text-indigo-400/70 hover:text-indigo-200 transition-colors"
            aria-label="Dismiss demo mode notice"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
