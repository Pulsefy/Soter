import { useCallback, useEffect, useRef } from 'react';
import { getNetworkDetails } from '@stellar/freighter-api';
import { useWalletStore } from '@/lib/walletStore';
import { EXPECTED_NETWORK } from '@/lib/env';

export interface NetworkGuardResult {
  /** true when the wallet is connected and on the correct network */
  isCorrectNetwork: boolean;
  /** true when a wallet is connected but on the wrong network */
  isMismatch: boolean;
  /** The network the wallet is currently reporting (null if not connected) */
  walletNetwork: string | null;
  /** The network this app expects */
  expectedNetwork: string;
  /**
   * Imperatively re-reads the network from Freighter and updates the store.
   * Useful to trigger an immediate refresh after the user acknowledges a
   * mismatch and switches network in Freighter.
   */
  refreshNetwork: () => Promise<void>;
}

/**
 * Compares the Freighter-reported network against EXPECTED_NETWORK.
 * Comparison is case-insensitive and ignores surrounding whitespace.
 *
 * Also exposes `refreshNetwork()` which re-reads from Freighter directly —
 * called by NetworkMismatchBanner after the user switches networks so the
 * session recovers without waiting for the 3-second polling interval.
 */
export function useNetworkGuard(): NetworkGuardResult {
  const { publicKey, network: walletNetwork, setNetwork } = useWalletStore();

  const isConnected = Boolean(publicKey);
  const isCorrectNetwork =
    isConnected &&
    walletNetwork != null &&
    walletNetwork.trim().toLowerCase() === EXPECTED_NETWORK.trim().toLowerCase();

  const refreshNetwork = useCallback(async () => {
    if (!publicKey) return;
    try {
      const netDetails = await getNetworkDetails();
      if (typeof netDetails === 'object' && netDetails !== null && 'network' in netDetails) {
        setNetwork(netDetails.network as string);
      } else if (typeof netDetails === 'string') {
        setNetwork(netDetails);
      }
    } catch {
      // Freighter may not be available; silently skip
    }
  }, [publicKey, setNetwork]);

  // When a mismatch is detected, poll every 2 s so the banner dismisses
  // automatically once the user switches network in Freighter.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMismatch = isConnected && !isCorrectNetwork;

  useEffect(() => {
    if (!isMismatch) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Start a faster polling loop while mismatched
    intervalRef.current = setInterval(() => {
      void refreshNetwork();
    }, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isMismatch, refreshNetwork]);

  return {
    isCorrectNetwork,
    isMismatch,
    walletNetwork,
    expectedNetwork: EXPECTED_NETWORK,
    refreshNetwork,
  };
}
