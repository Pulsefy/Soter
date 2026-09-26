import { useMemo, useState } from 'react';
import {
  OnChainNetworkGuard,
  NetworkMismatchResult,
  NetworkGuardConfig,
  checkNetworkGuard,
  DEFAULT_CONFIG,
  NetworkMismatchError,
  NetworkMismatchErrorCode,
} from '../services/networkGuard';
import { useWallet } from '../contexts/WalletContext';
import { useNetworkStatus } from './useNetworkStatus';

export interface NetworkGuardHookResult {
  /**
   * Whether there is a network mismatch.
   */
  isMismatch: boolean;

  /**
   * Full network mismatch result including error details.
   */
  mismatchResult: NetworkMismatchResult | null;

  /**
   * Clear the current mismatch state.
   */
  clearMismatch: () => void;

  /**
   * Imperatively check the current network state and return the result.
   */
  checkNetwork: () => NetworkMismatchResult;

  /**
   * Throw a NetworkMismatchError if the wallet is not on the correct network.
   * @throws {NetworkMismatchError}
   */
  ensureCorrectNetworkForSigning: () => void;

  /**
   * Human-readable error message for display.
   */
  errorMessage: string | null;

  /**
   * Human-readable remediation message for display.
   */
  remediationMessage: string | null;

  /**
   * Derived network info for the connected wallet.
   */
  walletNetworkInfo: {
    isTestnet: boolean;
    isMainnet: boolean;
    isKnown: boolean;
    networkName: string;
  } | null;
}

/**
 * Provides network guard functionality for wallet actions.
 *
 * Consumes chainIds directly from WalletContext — no global side-channel required.
 */
export const useNetworkGuard = (config?: Partial<NetworkGuardConfig>): NetworkGuardHookResult => {
  const { publicKey, status: walletStatus, chainIds } = useWallet();
  const networkStatus = useNetworkStatus();
  const [lastMismatch, setLastMismatch] = useState<NetworkMismatchResult | null>(null);

  const fullConfig: NetworkGuardConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const guard = useMemo(
    () =>
      new OnChainNetworkGuard(
        fullConfig.allowedNetworks[0] ?? 'TESTNET',
        fullConfig.autoReconnect,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullConfig.allowedNetworks[0], fullConfig.autoReconnect],
  );

  const checkNetwork = (): NetworkMismatchResult => {
    // Wallet not connected — surface as mismatch so callers don't need to check status separately
    if (walletStatus !== 'connected' || !publicKey) {
      const mismatchResult: NetworkMismatchResult = {
        isMismatch: true,
        error: new NetworkMismatchError(
          NetworkMismatchErrorCode.NO_NETWORK_CONNECTION,
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
        requiredNetwork: fullConfig.allowedNetworks[0] ?? 'TESTNET',
      };
      setLastMismatch(mismatchResult);
      return mismatchResult;
    }

    // Use chainIds from WalletContext — no global side-channel needed
    const result = checkNetworkGuard(chainIds, networkStatus, fullConfig);

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
        NetworkMismatchErrorCode.NO_NETWORK_CONNECTION,
        'Wallet is not connected. Please connect your wallet before signing.',
        'Connect your Stellar wallet to continue.',
      );
    }

    guard.ensureCorrectNetworkForSigning(chainIds, networkStatus);
  };

  const clearMismatch = (): void => {
    setLastMismatch(null);
  };

  // Derive the current mismatch lazily: use cached result or check if wallet is connected
  const currentMismatch = lastMismatch ?? (walletStatus === 'connected' ? checkNetwork() : null);

  const walletNetworkInfo = useMemo(() => {
    const info = currentMismatch?.walletNetwork;
    if (!info) {
      return {
        isTestnet: false,
        isMainnet: false,
        isKnown: false,
        networkName: 'Unknown',
      };
    }
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
