'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';

/**
 * Renders a sticky warning banner when the connected wallet is on the wrong
 * network. Returns null when there is no mismatch.
 */
export const NetworkMismatchBanner: React.FC = () => {
  const { isMismatch, walletNetwork, expectedNetwork } = useNetworkGuard();

  if (!isMismatch) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 w-full rounded-md border border-yellow-600 bg-yellow-900/30 px-4 py-3 text-yellow-200 text-sm"
    >
      <AlertTriangle className="mt-0.5 shrink-0 text-yellow-400" size={16} aria-hidden="true" />
      <div>
        <span className="font-semibold">Network mismatch — </span>
        your wallet is on{' '}
        <span className="font-mono font-semibold">{walletNetwork?.toUpperCase()}</span> but this
        app requires{' '}
        <span className="font-mono font-semibold">{expectedNetwork.toUpperCase()}</span>.{' '}
        Open Freighter and switch to the correct network to continue.
      </div>
    </div>
  );
};
