import { config } from './config';

type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet';

/**
 * Maps our network name to the stellar.expert path segment.
 * stellar.expert uses 'public' for mainnet.
 */
function toExplorerSegment(network: StellarNetwork): string {
  if (network === 'mainnet') return 'public';
  return network; // 'testnet' and 'futurenet' pass through unchanged
}

function explorerBase(): string {
  const segment = toExplorerSegment(config.network);
  return `https://stellar.expert/explorer/${segment}`;
}

export function getTxExplorerUrl(txHash: string): string {
  return `${explorerBase()}/tx/${txHash}`;
}

export function getContractExplorerUrl(contractId: string): string {
  return `${explorerBase()}/contract/${contractId}`;
}

export function getAccountExplorerUrl(address: string): string {
  return `${explorerBase()}/account/${address}`;
}
