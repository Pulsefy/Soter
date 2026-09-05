/**
 * Single source of truth for Stellar/Soroban network profiles.
 *
 * Every consumer that needs a network passphrase, RPC URL default, or
 * block explorer base URL should read it from here instead of hardcoding
 * its own copy. This is what network-config.validation.ts checks env vars
 * against at startup.
 */
export type NetworkName = 'testnet' | 'futurenet' | 'mainnet';

export interface NetworkProfile {
  /** Human-readable label for display in the UI. */
  label: string;
  /** Exact Stellar network passphrase for this network. */
  passphrase: string;
  /** Default Soroban RPC URL used when STELLAR_RPC_URL is not set. */
  defaultRpcUrl: string;
  /** stellar.expert base URL for building explorer links. */
  explorerBase: string;
  /** Keywords that, if found in an RPC URL, indicate it belongs to a different network. */
  foreignRpcKeywords: string[];
}

export const NETWORK_PROFILES: Record<NetworkName, NetworkProfile> = {
  testnet: {
    label: 'Testnet',
    passphrase: 'Test SDF Network ; September 2015',
    defaultRpcUrl: 'https://soroban-testnet.stellar.org',
    explorerBase: 'https://stellar.expert/explorer/testnet',
    foreignRpcKeywords: ['mainnet'],
  },
  futurenet: {
    label: 'Futurenet',
    passphrase: 'Test SDF Future Network ; October 2022',
    defaultRpcUrl: 'https://rpc-futurenet.stellar.org',
    explorerBase: 'https://stellar.expert/explorer/futurenet',
    foreignRpcKeywords: ['mainnet'],
  },
  mainnet: {
    label: 'Mainnet',
    passphrase: 'Public Global Stellar Network ; September 2015',
    defaultRpcUrl: 'https://mainnet.sorobanrpc.com',
    explorerBase: 'https://stellar.expert/explorer/public',
    foreignRpcKeywords: ['testnet', 'futurenet'],
  },
};

export const DEFAULT_NETWORK: NetworkName = 'testnet';

export function isNetworkName(value: string): value is NetworkName {
  return value in NETWORK_PROFILES;
}

export function getNetworkProfile(
  network: string | undefined,
  rpcUrl?: string,
): NetworkProfile {
  const resolved = resolveNetwork(network, rpcUrl);
  return NETWORK_PROFILES[resolved];
}

/**
 * Determine the effective network name from the configured network and an
 * optional RPC URL. If an RPC URL is provided and clearly indicates a
 * different network, that network takes precedence so explorer links and
 * other network-dependent URLs use the correct profile.
 */
export function resolveNetwork(
  network: string | undefined,
  rpcUrl?: string,
): NetworkName {
  const configured = (network || DEFAULT_NETWORK).toLowerCase();
  const configuredNetwork = isNetworkName(configured)
    ? configured
    : DEFAULT_NETWORK;

  if (rpcUrl) {
    const detected = getNetworkFromRpcUrl(rpcUrl);
    if (detected) return detected;
  }

  return configuredNetwork;
}

/**
 * Derive the network name from an RPC URL by matching well-known substrings.
 * Falls back to undefined if no network can be inferred.
 */
export function getNetworkFromRpcUrl(rpcUrl: string): NetworkName | undefined {
  const url = rpcUrl.toLowerCase();
  if (url.includes('futurenet')) return 'futurenet';
  // Must check futurenet before testnet because futurenet URLs don't contain
  // 'testnet', but to be safe we check exact substrings in order.
  if (url.includes('testnet')) return 'testnet';
  if (url.includes('mainnet')) return 'mainnet';
  return undefined;
}

/**
 * Build a block explorer URL for a given entity type and ID on the specified
 * network. This centralizes explorer link construction and guarantees the
 * correct network base is used.
 */
export function buildExplorerUrl(
  network: NetworkName,
  type: 'contract' | 'account' | 'transaction',
  id: string,
): string {
  const base = NETWORK_PROFILES[network].explorerBase;
  const paths = {
    contract: 'contract',
    account: 'account',
    transaction: 'tx',
  };
  return `${base}/${paths[type]}/${id}`;
}

/**
 * Return all network profiles with their names, suitable for UI selection
 * and admin copy-to-clipboard features.
 */
export function getAllNetworkProfiles(): Array<
  NetworkProfile & { name: NetworkName }
> {
  return (Object.keys(NETWORK_PROFILES) as NetworkName[]).map((name) => ({
    name,
    ...NETWORK_PROFILES[name],
  }));
}
