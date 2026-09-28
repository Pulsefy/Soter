import { getNetworkProfile } from 'src/config/network.config';

/** Returns the explorer base URL for the given network, defaulting to testnet. */
export function explorerBase(network: string): string {
  return getNetworkProfile(network).explorerBase;
}

/** Returns a link to a transaction on stellar.expert. */
export function explorerTxUrl(txHash: string, network: string): string {
  return `${explorerBase(network)}/tx/${txHash}`;
}

/** Returns a link to a contract (account) on stellar.expert. */
export function explorerContractUrl(
  contractId: string,
  network: string,
): string {
  return `${explorerBase(network)}/contract/${contractId}`;
}
