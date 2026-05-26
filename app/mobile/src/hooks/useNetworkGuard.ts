import { useWallet } from '../contexts/WalletContext';

export interface NetworkGuardState {
  /** True when the connected wallet session contains a chain ID that does not
   *  match the expected chain (e.g. stellar:testnet). False when disconnected
   *  or all session chains match. */
  networkMismatch: boolean;
  /** Deduplicated CAIP-10 chain IDs from the active WalletConnect session.
   *  Empty array when the wallet is disconnected. */
  sessionChainIds: string[];
}

/**
 * Exposes network mismatch state derived from WalletContext.
 *
 * Must be called inside a WalletProvider — throws otherwise (via useWallet).
 */
export const useNetworkGuard = (): NetworkGuardState => {
  const { networkMismatch, sessionChainIds } = useWallet();
  return { networkMismatch, sessionChainIds };
};
