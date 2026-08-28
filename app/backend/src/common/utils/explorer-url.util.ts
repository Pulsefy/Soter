import { getNetworkProfile } from 'src/config/network.config';

const DEFAULT_NETWORK = 'testnet';

/** Returns the explorer base URL for the given network, defaulting to testnet. */
export function explorerBase(network: string = DEFAULT_NETWORK): string {
  return getNetworkProfile(network).explorerBase;
}

/** Returns a link to a transaction on stellar.expert. */
export function explorerTxUrl(txHash: string, network: string = DEFAULT_NETWORK): string {
  return `${explorerBase(network)}/tx/${txHash}`;
}

/** Returns a link to a contract (account) on stellar.expert. */
export function explorerContractUrl(
  contractId: string,
  network: string = DEFAULT_NETWORK,
): string {
  return `${explorerBase(network)}/contract/${contractId}`;
}

/** Returns the full network profile from the shared config. */
export function getNetworkMetadata(
  network: string = DEFAULT_NETWORK,
): ReturnType<typeof getNetworkProfile> {
  return getNetworkProfile(network);
}

/** Returns a human-readable network label. */
export function getNetworkLabel(
  network: string = DEFAULT_NETWORK,
): string {
  const profile = getNetworkMetadata(network);
  return profile.label ?? network;
}

/** Formats a contract registry value for easy copying in admin UI. */
export function formatContractRegistryValue(
  contractId: string,
  network: string = DEFAULT_NETWORK,
): string {
  return `${getNetworkLabel(network)}:${contractId}`;
}
