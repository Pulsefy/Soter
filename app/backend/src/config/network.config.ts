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
    passphrase: 'Test SDF Network ; September 2015',
    defaultRpcUrl: 'https://soroban-testnet.stellar.org',
    explorerBase: 'https://stellar.expert/explorer/testnet',
    foreignRpcKeywords: ['mainnet'],
  },
  futurenet: {
    passphrase: 'Test SDF Future Network ; October 2022',
    defaultRpcUrl: 'https://rpc-futurenet.stellar.org',
    explorerBase: 'https://stellar.expert/explorer/futurenet',
    foreignRpcKeywords: ['mainnet'],
  },
  mainnet: {
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

export function getNetworkProfile(network: string | undefined): NetworkProfile {
  const normalized = (network || DEFAULT_NETWORK).toLowerCase();
  return NETWORK_PROFILES[
    isNetworkName(normalized) ? normalized : DEFAULT_NETWORK
  ];
}
