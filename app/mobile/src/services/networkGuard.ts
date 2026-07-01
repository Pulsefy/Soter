import { config, getStellarChainId } from '../config';
import { NetworkStatus } from '../hooks/useNetworkStatus';

/**
 * Network mismatch error types
 */
export enum NetworkMismatchErrorCode {
  WALLET_ON_MAINNET = 'WALLET_ON_MAINNET',
  NO_NETWORK_CONNECTION = 'NO_NETWORK_CONNECTION',
  NETWORK_UNREACHABLE = 'NETWORK_UNREACHABLE',
  CHAIN_MISMATCH = 'CHAIN_MISMATCH',
}

export class NetworkMismatchError extends Error {
  public readonly code: NetworkMismatchErrorCode;
  public readonly remediation: string;

  constructor(code: NetworkMismatchErrorCode, message: string, remediation: string) {
    super(message);
    this.name = 'NetworkMismatchError';
    this.code = code;
    this.remediation = remediation;
    Object.setPrototypeOf(this, NetworkMismatchError.prototype);
  }
}

/**
 * Stellar network configurations
 */
export const STELLAR_NETWORKS = {
  TESTNET: {
    chainId: 'testnet',
    passphrase: 'Test SDF Network ; September 2015',
    explorerUrl: 'https://testnet.stellar.expert',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  MAINNET: {
    chainId: 'public',
    passphrase: 'Public Global Stellar Network ; September 2015',
    explorerUrl: 'https://stellar.expert',
    horizonUrl: 'https://horizon.stellar.org',
  },
} as const;

export type StellarNetwork = keyof typeof STELLAR_NETWORKS;

/**
 * Network guard configuration
 */
export interface NetworkGuardConfig {
  requiredChainId: string;
  allowedNetworks: StellarNetwork[];
  autoReconnect: boolean;
  showRemediationUI: boolean;
}

const DEFAULT_CONFIG: NetworkGuardConfig = {
  requiredChainId: 'testnet',
  allowedNetworks: ['TESTNET'],
  autoReconnect: false,
  showRemediationUI: true,
};

/**
 * Detected wallet network information
 */
export interface WalletNetworkInfo {
  network: StellarNetwork | null;
  chainId: string | null;
  isTestnet: boolean;
  isMainnet: boolean;
  isKnown: boolean;
}

/**
 * Network mismatch result
 */
export interface NetworkMismatchResult {
  isMismatch: boolean;
  error: NetworkMismatchError | null;
  walletNetwork: WalletNetworkInfo | null;
  requiredNetwork: StellarNetwork;
}

/**
 * Detect the wallet's current network from chain IDs
 */
export const detectWalletNetwork = (
  chainIds: string[] | string | null | undefined,
): WalletNetworkInfo => {
  const normalizedChainIds = Array.isArray(chainIds)
    ? chainIds
    : chainIds
      ? [chainIds]
      : [];

  // Default to unknown
  const result: WalletNetworkInfo = {
    network: null,
    chainId: null,
    isTestnet: false,
    isMainnet: false,
    isKnown: false,
  };

  for (const chainId of normalizedChainIds) {
    // Stellar chain IDs follow format: "stellar:testnet" or "stellar:public"
    const parts = chainId.split(':');
    if (parts.length >= 2 && parts[0] === 'stellar') {
      const networkId = parts[1];
      result.chainId = chainId;

      if (networkId === 'testnet') {
        result.network = 'TESTNET';
        result.isTestnet = true;
        result.isKnown = true;
        break;
      } else if (networkId === 'public') {
        result.network = 'MAINNET';
        result.isMainnet = true;
        result.isKnown = true;
        break;
      }
    }
  }

  return result;
};

/**
 * Validates if the wallet is on the correct network
 * @param walletChainIds - Chain IDs from the connected wallet
 * @param requiredNetwork - The required network (default: TESTNET)
 */
export const validateWalletNetwork = (
  walletChainIds: string[] | string | null | undefined,
  requiredNetwork: StellarNetwork = 'TESTNET',
): void => {
  if (!walletChainIds || (Array.isArray(walletChainIds) && walletChainIds.length === 0)) {
    throw new NetworkMismatchError(
      NetworkMismatchErrorCode.NO_NETWORK_CONNECTION,
      'No wallet connection detected. Please connect your wallet.',
      'Please connect a Stellar wallet to continue.',
    );
  }

  const walletInfo = detectWalletNetwork(walletChainIds);
  const requiredChainId = STELLAR_NETWORKS[requiredNetwork].chainId;

  // Check if wallet is on the wrong network
  if (walletInfo.isKnown && walletInfo.network !== requiredNetwork) {
    const errorMessage = walletInfo.isMainnet
      ? 'Wallet is connected to Mainnet. This action requires Testnet.'
      : `Wallet is connected to ${walletInfo.network?.toLowerCase() ?? 'unknown'} network. Expected ${requiredNetwork.toLowerCase()}.`;

    const remediation = walletInfo.isMainnet
      ? 'Please switch your wallet to Testnet. In your wallet settings, change the network from "Mainnet" to "Testnet".'
      : `Please switch your wallet to ${requiredNetwork}. In your wallet settings, change the network to ${requiredNetwork}.`;

    throw new NetworkMismatchError(
      walletInfo.isMainnet
        ? NetworkMismatchErrorCode.WALLET_ON_MAINNET
        : NetworkMismatchErrorCode.CHAIN_MISMATCH,
      errorMessage,
      remediation,
    );
  }

  // Check if network is unreachable or not detected
  if (!walletInfo.isKnown) {
    throw new NetworkMismatchError(
      NetworkMismatchErrorCode.NETWORK_UNREACHABLE,
      'Could not detect wallet network. Please ensure your wallet is connected to Testnet.',
      'Check your wallet connection and ensure you are on the Testnet network.',
    );
  }
};

/**
 * Checks if the device has a working network connection
 */
export const validateNetworkConnection = (networkStatus: NetworkStatus): void => {
  if (!networkStatus.isConnected) {
    throw new NetworkMismatchError(
      NetworkMismatchErrorCode.NO_NETWORK_CONNECTION,
      'No internet connection detected.',
      'Please check your internet connection and try again.',
    );
  }

  if (networkStatus.isInternetReachable === false) {
    throw new NetworkMismatchError(
      NetworkMismatchErrorCode.NETWORK_UNREACHABLE,
      'Internet is unreachable.',
      'Please check your network settings and try again.',
    );
  }
};

/**
 * Main network guard function that performs all validation
 */
export const checkNetworkGuard = (
  walletChainIds: string[] | string | null | undefined,
  networkStatus: NetworkStatus,
  config: NetworkGuardConfig = DEFAULT_CONFIG,
): NetworkMismatchResult => {
  try {
    // First validate device network connection
    validateNetworkConnection(networkStatus);

    // Then validate wallet network
    validateWalletNetwork(walletChainIds, config.allowedNetworks[0] || 'TESTNET');

    // All validations passed
    return {
      isMismatch: false,
      error: null,
      walletNetwork: detectWalletNetwork(walletChainIds),
      requiredNetwork: config.allowedNetworks[0] || 'TESTNET',
    };
  } catch (error) {
    if (error instanceof NetworkMismatchError) {
      return {
        isMismatch: true,
        error,
        walletNetwork: detectWalletNetwork(walletChainIds),
        requiredNetwork: config.allowedNetworks[0] || 'TESTNET',
      };
    }

    // Re-throw unexpected errors
    throw error;
  }
};

/**
 * Generate a human-readable remediation message
 */
export const getRemediationMessage = (error: NetworkMismatchError | null): string => {
  if (!error) {
    return '';
  }
  return error.remediation;
};

/**
 * Generate an error description for UI display
 */
export const getNetworkErrorMessage = (error: NetworkMismatchError | null): string => {
  if (!error) {
    return '';
  }
  return error.message;
};

/**
 * Check if an action should be blocked due to network mismatch
 */
export const shouldBlockAction = (result: NetworkMismatchResult): boolean => {
  return result.isMismatch && result.error !== null;
};

/**
 * Get the required network display name
 */
export const getRequiredNetworkDisplayName = (network: StellarNetwork): string => {
  return network === 'TESTNET' ? 'Testnet' : 'Mainnet';
};

/**
 * Get the current network display name
 */
export const getCurrentNetworkDisplayName = (walletInfo: WalletNetworkInfo | null): string => {
  if (!walletInfo || !walletInfo.isKnown) {
    return 'Unknown';
  }
  return walletInfo.network === 'TESTNET' ? 'Testnet' : 'Mainnet';
};

/**
 * Validate network before signing operations
 * This is a convenience wrapper for use in transaction signing
 */
export const ensureCorrectNetworkForSigning = (
  walletChainIds: string[] | string | null | undefined,
  networkStatus: NetworkStatus,
): void => {
  // Validate device network
  validateNetworkConnection(networkStatus);

  // Validate wallet network with stricter requirements for signing
  if (!walletChainIds || (Array.isArray(walletChainIds) && walletChainIds.length === 0)) {
    throw new NetworkMismatchError(
      NetworkMismatchErrorCode.NO_NETWORK_CONNECTION,
      'No wallet connected. Please connect your wallet before signing.',
      'Connect your Stellar wallet to continue.',
    );
  }

  const walletInfo = detectWalletNetwork(walletChainIds);

  if (!walletInfo.isKnown) {
    throw new NetworkMismatchError(
      NetworkMismatchErrorCode.NETWORK_UNREACHABLE,
      'Cannot determine wallet network. Ensure your wallet is on Testnet.',
      'Check your wallet settings and switch to Testnet.',
    );
  }

  if (!walletInfo.isTestnet) {
    throw new NetworkMismatchError(
      NetworkMismatchErrorCode.WALLET_ON_MAINNET,
      '⚠️ SIGNING BLOCKED: Wallet is on Mainnet. Actions that require signatures must be performed on Testnet.',
      'Please switch to Testnet in your wallet settings and reconnect.',
    );
  }
};

/**
 * Network guard for on-chain actions that require signatures
 */
export class OnChainNetworkGuard {
  private requiredNetwork: StellarNetwork;
  private autoReconnect: boolean;

  constructor(
    requiredNetwork: StellarNetwork = 'TESTNET',
    autoReconnect: boolean = false,
  ) {
    this.requiredNetwork = requiredNetwork;
    this.autoReconnect = autoReconnect;
  }

  /**
   * Check if the wallet is in the correct network for on-chain actions
   */
  public check(
    walletChainIds: string[] | string | null | undefined,
    networkStatus: NetworkStatus,
  ): NetworkMismatchResult {
    const config: NetworkGuardConfig = {
      requiredChainId: STELLAR_NETWORKS[this.requiredNetwork].chainId,
      allowedNetworks: [this.requiredNetwork],
      autoReconnect: this.autoReconnect,
      showRemediationUI: true,
    };

    return checkNetworkGuard(walletChainIds, networkStatus, config);
  }

  /**
   * Block signing if network is wrong
   */
  public ensureCorrectNetworkForSigning(
    walletChainIds: string[] | string | null | undefined,
    networkStatus: NetworkStatus,
  ): void {
    const result = this.check(walletChainIds, networkStatus);

    if (result.isMismatch && result.error) {
      throw result.error;
    }
  }

  /**
   * Get the remediation instructions for the current mismatch
   */
  public getRemediationInstructions(result: NetworkMismatchResult): string {
    if (!result.isMismatch || !result.error) {
      return 'Network is correct.';
    }
    return result.error.remediation;
  }
}