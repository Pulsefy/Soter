'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';

/**
 * Renders a sticky warning banner when the connected wallet is on the wrong
 * network. Returns null when there is no mismatch.
 */
export const NetworkMismatchBanner: React.FC = () => {
  const t = useTranslations();
  const { isMismatch, walletNetwork, expectedNetwork } = useNetworkGuard();

  if (!isMismatch) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-40 flex items-start gap-3 w-full border-b border-yellow-600 bg-yellow-900/40 px-4 py-3 text-yellow-200 text-sm backdrop-blur-sm"
    >
      <AlertTriangle className="mt-0.5 shrink-0 text-yellow-400" size={16} aria-hidden="true" />
      <div>
        {t('wallet.networkMismatch', {
          walletNetwork: walletNetwork?.toUpperCase() ?? '',
          expectedNetwork: expectedNetwork.toUpperCase(),
        })}
      </div>
    </div>
  );
};
