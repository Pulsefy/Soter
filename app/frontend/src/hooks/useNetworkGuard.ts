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
}

/**
 * Compares the Freighter-reported network against EXPECTED_NETWORK.
 * Comparison is case-insensitive and ignores surrounding whitespace.
 */
export function useNetworkGuard(): NetworkGuardResult {
  const { publicKey, network: walletNetwork } = useWalletStore();

  const isConnected = Boolean(publicKey);
  const isCorrectNetwork =
    isConnected &&
    walletNetwork != null &&
    walletNetwork.trim().toLowerCase() === EXPECTED_NETWORK.trim().toLowerCase();

  return {
    isCorrectNetwork,
    isMismatch: isConnected && !isCorrectNetwork,
    walletNetwork,
    expectedNetwork: EXPECTED_NETWORK,
  };
}
