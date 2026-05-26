/**
 * NetworkGuard — chain ID mismatch detection for WalletConnect sessions.
 *
 * Provides a single service boundary for all network-guard logic so that
 * WalletContext, hooks, and components all import from here rather than
 * directly from walletConnect.ts.
 */

// Re-export so consumers have one import boundary for CAIP-10 parsing.
export { extractChainIdsFromAccounts } from './walletConnect';

/**
 * Returns `true` when at least one session chain ID does not match the
 * expected chain ID, indicating the wallet is on the wrong network.
 *
 * Returns `false` when:
 *  - `chainIds` is empty (wallet disconnected or no accounts)
 *  - every chain ID in `chainIds` equals `expectedChainId`
 *
 * @param chainIds      Deduplicated CAIP-10 chain IDs from the active session
 *                      (e.g. ["stellar:testnet", "stellar:mainnet"])
 * @param expectedChainId  The chain the app requires (e.g. "stellar:testnet")
 */
export const detectNetworkMismatch = (
  chainIds: string[],
  expectedChainId: string,
): boolean => {
  if (chainIds.length === 0) {
    return false;
  }
  return chainIds.some((id) => id !== expectedChainId);
};
