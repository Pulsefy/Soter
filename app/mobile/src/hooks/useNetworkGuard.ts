import { useMemo, useState } from 'react';
import {
  OnChainNetworkGuard,
  NetworkMismatchResult,
  NetworkGuardConfig,
  checkNetworkGuard,
  DEFAULT_CONFIG,
  NetworkMismatchError,
} from '../services/networkGuard';
import { useWallet } from '../contexts/WalletContext';
import { useNetworkStatus } from './useNetworkStatus';

export interface NetworkGuardHookResult {
  /**
   * Whether there is a network mismatch
   */
  isMismatch: boolean;

  /**
   * The network mismatch result containing error details
   */
  mismatchResult: NetworkMismatchResult | null;

  /**
   * Clear the current mismatch state
   */
  clearMismatch: () => void;

  /**
   * Check the current network state
   */
  checkNetwork: () => NetworkMismatchResult;

  /**
   * Block any action that requires signing if network is wrong
   * @throws {NetworkMismatchError} if network is not correct
   */
  ensureCorrectNetworkForSigning: () => void;

  /**
   * Get a human-readable error message for UI display
   */
  errorMessage: string | null;

  /**
   * Get a human-readable remediation message
   */
  remediationMessage: string | null;

  /**
   * The wallet's current network info
   */
  walletNetworkInfo: {
    isTestnet: boolean;
    isMainnet: boolean;
    isKnown: boolean;
    networkName: string;
  } | null;
}

/**
 * Hook that provides network guard functionality for wallet actions
 */
export const useNetworkGuard = (config?: Partial<NetworkGuardConfig>): NetworkGuardHookResult => {
  const { publicKey, status: walletStatus } = useWallet();
  const networkStatus = useNetworkStatus();
  const [lastMismatch, setLastMismatch] = useState<NetworkMismatchResult | null>(null);

  const fullConfig: NetworkGuardConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const guard = useMemo(() => {
    return new OnChainNetworkGuard(
      fullConfig.allowedNetworks[0] || 'TESTNET',
      fullConfig.autoReconnect,
    );
  }, [fullConfig.allowedNetworks, fullConfig.autoReconnect]);

  const checkNetwork = (): NetworkMismatchResult => {
    // If wallet is not connected, return a mismatch result
    if (walletStatus !== 'connected' || !publicKey) {
      const mismatchResult: NetworkMismatchResult = {
        isMismatch: true,
        error: new NetworkMismatchError(
          'NO_NETWORK_CONNECTION' as any,
          'Wallet is not connected.',
          'Please connect your wallet to continue.',
        ),
        walletNetwork: {
          network: null,
          chainId: null,
          isTestnet: false,
          isMainnet: false,
          isKnown: false,
        },
        requiredNetwork: fullConfig.allowedNetworks[0] || 'TESTNET',
      };
      setLastMismatch(mismatchResult);
      return mismatchResult;
    }

    // Get wallet chain IDs from the wallet context
    // Note: We need to store chainIds in WalletContext - will update in next file
    // For now, we'll use a placeholder approach where we detect from publicKey
    // In the full implementation, we'll store chainIds in context
    const chainIds = (global as any).__walletChainIds || [];

    const result = checkNetworkGuard(
      chainIds,
      networkStatus,
      fullConfig,
    );

    if (result.isMismatch) {
      setLastMismatch(result);
    } else {
      setLastMismatch(null);
    }

    return result;
  };

  const ensureCorrectNetworkForSigning = (): void => {
    if (walletStatus !== 'connected' || !publicKey) {
      throw new NetworkMismatchError(
        'NO_NETWORK_CONNECTION' as any,
        'Wallet is not connected. Please connect your wallet before signing.',
        'Connect your Stellar wallet to continue.',
      );
    }

    const chainIds = (global as any).__walletChainIds || [];
    guard.ensureCorrectNetworkForSigning(chainIds, networkStatus);
  };

  const clearMismatch = (): void => {
    setLastMismatch(null);
  };

  // Get the current mismatch result or check if there is one
  const currentMismatch = lastMismatch ?? (walletStatus === 'connected' ? checkNetwork() : null);

  const walletNetworkInfo = useMemo(() => {
    if (!currentMismatch?.walletNetwork) {
      return {
        isTestnet: false,
        isMainnet: false,
        isKnown: false,
        networkName: 'Unknown',
      };
    }

    const info = currentMismatch.walletNetwork;
    return {
      isTestnet: info.isTestnet,
      isMainnet: info.isMainnet,
      isKnown: info.isKnown,
      networkName: info.isTestnet ? 'Testnet' : info.isMainnet ? 'Mainnet' : 'Unknown',
    };
  }, [currentMismatch]);

  return {
    isMismatch: currentMismatch?.isMismatch ?? false,
    mismatchResult: currentMismatch,
    clearMismatch,
    checkNetwork,
    ensureCorrectNetworkForSigning,
    errorMessage: currentMismatch?.error?.message ?? null,
    remediationMessage: currentMismatch?.error?.remediation ?? null,
    walletNetworkInfo,
  };
};