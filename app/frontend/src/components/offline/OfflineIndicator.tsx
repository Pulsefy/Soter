'use client';

import React from 'react';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';

/**
 * Sticky banner shown when the dashboard has lost its connection.
 *
 * Two situations are covered (issue #1345):
 *
 * 1. The browser reports offline (`navigator.onLine === false`) — the
 *    service worker serves the last successfully fetched dashboard data
 *    from cache, and this banner explains why the view may be dated.
 * 2. The browser reports online but the backend is unreachable — the
 *    service worker times out and falls back to the same cache, so the
 *    banner still reflects what the user is actually seeing.
 *
 * The banner disappears as soon as a live network response lands again;
 * reconnect refreshes are silent (React Query's `refetchOnReconnect` plus
 * the dashboard's own `online` listener refetch in the background).
 *
 * Returns null when data is fresh from the network.
 */
export const OfflineIndicator: React.FC = () => {
  const t = useTranslations('offline');
  const { isOnline, isServingCachedData } = useOfflineStatus();

  if (isOnline && !isServingCachedData) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 w-full border-b border-amber-600 bg-amber-900/40 px-4 py-3 text-amber-200 text-sm backdrop-blur-sm"
    >
      <div className="flex items-start gap-3">
        <WifiOff
          className="mt-0.5 shrink-0 text-amber-400"
          size={16}
          aria-hidden="true"
        />
        <p className="leading-snug">
          {isOnline ? t('unreachable') : t('banner')}
        </p>
      </div>
    </div>
  );
};
