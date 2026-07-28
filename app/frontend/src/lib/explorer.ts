import { stellarNetwork } from './env';

export type ExplorerLinkType = 'contract' | 'tx' | 'address';

/**
 * Builds a Stellar Expert explorer URL for the configured network.
 * Supports contract, transaction, and address links.
 */
export function buildExplorerUrl(
  type: ExplorerLinkType,
  identifier: string,
  network = stellarNetwork
): string {
  const cleanNetwork = (network || 'testnet').toLowerCase().trim();

  // Stellar Expert uses 'public' for mainnet, 'futurenet' for futurenet,
  // and 'testnet' for testnet.
  let explorerNetwork = 'testnet';
  if (cleanNetwork === 'mainnet' || cleanNetwork === 'public') {
    explorerNetwork = 'public';
  } else if (cleanNetwork === 'futurenet') {
    explorerNetwork = 'futurenet';
  }

  return `https://stellar.expert/explorer/${explorerNetwork}/${type}/${identifier}`;
}
