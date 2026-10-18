'use client';

import { Settings2, X } from 'lucide-react';
import { useState } from 'react';

interface EnvWarningBannerProps {
  missing: string[];
  invalid: string[];
}

export function EnvWarningBanner({ missing, invalid }: EnvWarningBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 shrink-0">
            <Settings2 size={20} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Preview deployment — some environment variables are missing or invalid
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-200/80 mt-1">
              This is expected for preview builds. Some features may be limited.
            </p>
            {(missing.length > 0 || invalid.length > 0) && (
              <div className="mt-2 space-y-1">
                {missing.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-200/70 font-mono">
                    Missing: {missing.join(', ')}
                  </p>
                )}
                {invalid.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-200/70 font-mono">
                    Invalid: {invalid.join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setIsDismissed(true)}
            className="text-amber-700/70 hover:text-amber-800 dark:text-amber-300/70 dark:hover:text-amber-200 transition-colors"
            aria-label="Dismiss environment warning"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
