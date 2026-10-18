'use client';

import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';
import { useWalletStore } from '@/lib/walletStore';

/**
 * Sticky banner rendered when the connected wallet is on the wrong network.
 *
 * Beyond a simple warning it offers two recovery actions:
 *
 * 1. **Refresh Session** — calls `refreshNetwork()` to immediately re-read the
 *    network from Freighter after the user switches in Freighter's UI, without
 *    waiting for the 3-second polling interval.
 *
 * 2. **Disconnect** — wipes the persisted session so the user can reconnect
 *    with a correctly-configured wallet. This is the safest path when the user
 *    cannot switch network in Freighter (e.g. a read-only account on the wrong
 *    chain).
 *
 * The banner also self-dismisses automatically when the wallet's network
 * transitions to the correct one (driven by the accelerated polling loop in
 * `useNetworkGuard`).
 *
 * Returns null when there is no mismatch.
 */
export const NetworkMismatchBanner: React.FC = () => {
  const t = useTranslations();
  const { isMismatch, walletNetwork, expectedNetwork, refreshNetwork } = useNetworkGuard();
  const { disconnect } = useWalletStore();
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!isMismatch) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshNetwork();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-40 w-full border-b border-yellow-600 bg-yellow-900/40 px-4 py-3 text-yellow-200 text-sm backdrop-blur-sm"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 shrink-0 text-yellow-400"
          size={16}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="leading-snug">
            {t('wallet.networkMismatch', {
              walletNetwork: walletNetwork?.toUpperCase() ?? '',
              expectedNetwork: expectedNetwork.toUpperCase(),
            })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Refresh Session — re-reads network from Freighter immediately */}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              aria-label={t('wallet.refreshSessionLabel')}
              className="inline-flex items-center gap-1.5 rounded-md border border-yellow-500 bg-yellow-800/60 px-3 py-1.5 text-xs font-medium text-yellow-100 hover:bg-yellow-700/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              <RefreshCw
                size={12}
                aria-hidden="true"
                className={isRefreshing ? 'animate-spin' : ''}
              />
              {isRefreshing
                ? t('wallet.refreshingSession')
                : t('wallet.refreshSession')}
            </button>

            {/* Disconnect — clear session so the user can reconnect cleanly */}
            <button
              type="button"
              onClick={handleDisconnect}
              aria-label={t('wallet.disconnectToReconnectLabel')}
              className="inline-flex items-center gap-1.5 rounded-md border border-yellow-700 bg-transparent px-3 py-1.5 text-xs font-medium text-yellow-300 hover:bg-yellow-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1 transition"
            >
              <WifiOff size={12} aria-hidden="true" />
              {t('wallet.disconnectAndReconnect')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
