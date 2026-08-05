import React, { PropsWithChildren, createContext, useContext, useEffect, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import {
  ConnectedWalletSession,
  WalletConnectionStatus,
  createWalletConnection,
  disconnectWalletSession,
  openWalletConnectPairingUri,
  restoreWalletSession,
} from '../services/walletConnect';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { detectWalletNetwork, WalletNetworkInfo } from '../services/networkGuard';

/**
 * Lifecycle state of the session-restore bootstrap.
 *
 * - 'restoring'  The provider is currently calling restoreWalletSession on mount.
 * - 'restored'   A persisted session was found and rehydrated successfully.
 * - 'none'       Bootstrap completed but no stored session was found.
 * - 'failed'     Bootstrap threw an error; the session could not be restored.
 */
export type RestoreStatus = 'restoring' | 'restored' | 'none' | 'failed';

interface WalletContextValue {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  /**
   * Clears a 'failed' restore or connect error and resets the wallet to idle,
   * allowing the user to attempt a fresh connection.
   */
  recoverSession: () => void;
  error: string | null;
  lastDeepLinkUrl: string | null;
  pairingUri: string | null;
  publicKey: string | null;
  reopenWallet: () => Promise<void>;
  status: WalletConnectionStatus;
  /** Lifecycle state of the on-mount session-restore bootstrap. */
  restoreStatus: RestoreStatus;
  walletName: string | null;
  // Network-related properties
  chainIds: string[];
  walletNetworkInfo: WalletNetworkInfo | null;
  isOnCorrectNetwork: boolean;
  checkNetwork: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected wallet error occurred.';
};

const idleState = {
  error: null,
  pairingUri: null,
  publicKey: null,
  status: 'idle' as WalletConnectionStatus,
  walletName: null,
};

export const WalletProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<WalletConnectionStatus>('idle');
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('restoring');
  const [topic, setTopic] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [lastDeepLinkUrl, setLastDeepLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Network state
  const [chainIds, setChainIds] = useState<string[]>([]);
  const [walletNetworkInfo, setWalletNetworkInfo] = useState<WalletNetworkInfo | null>(null);
  const [isOnCorrectNetwork, setIsOnCorrectNetwork] = useState<boolean>(false);

  const networkStatus = useNetworkStatus();

  useEffect(() => {
    let isMounted = true;

    const applyConnectedSession = (session: ConnectedWalletSession) => {
      if (!isMounted) return;

      setTopic(session.topic);
      setPublicKey(session.publicKey);
      setWalletName(session.walletName);
      setPairingUri(null);
      setError(null);
      setStatus('connected');

      const sessionChainIds = session.chainIds ?? [];
      setChainIds(sessionChainIds);

      const networkInfo = detectWalletNetwork(sessionChainIds);
      setWalletNetworkInfo(networkInfo);
      setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
    };

    const bootstrap = async () => {
      try {
        const existingSession = await restoreWalletSession();
        if (isMounted) {
          if (existingSession) {
            applyConnectedSession(existingSession);
            setRestoreStatus('restored');
          } else {
            setRestoreStatus('none');
          }
        }
      } catch (sessionError) {
        if (isMounted) {
          setError(getErrorMessage(sessionError));
          setStatus('error');
          setRestoreStatus('failed');
        }
      }
    };

    const captureInitialUrl = async () => {
      const url = await ExpoLinking.getInitialURL();
      if (url && isMounted) {
        setLastDeepLinkUrl(url);
      }
    };

    void bootstrap();
    void captureInitialUrl();

    const subscription = ExpoLinking.addEventListener('url', ({ url }) => {
      setLastDeepLinkUrl(url);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  // Re-validate network when chainIds or connectivity changes
  useEffect(() => {
    if (status === 'connected' && chainIds.length > 0) {
      const networkInfo = detectWalletNetwork(chainIds);
      setWalletNetworkInfo(networkInfo);
      setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
    }
  }, [chainIds, status, networkStatus]);

  const resetWalletState = () => {
    setTopic(null);
    setPublicKey(idleState.publicKey);
    setWalletName(idleState.walletName);
    setPairingUri(idleState.pairingUri);
    setError(idleState.error);
    setStatus(idleState.status);
    setChainIds([]);
    setWalletNetworkInfo(null);
    setIsOnCorrectNetwork(false);
  };

  const connectWallet = async () => {
    setStatus('connecting');
    setError(null);

    try {
      const { pairingUri: nextPairingUri, approval } = await createWalletConnection();
      setPairingUri(nextPairingUri);
      setStatus('awaiting-approval');

      try {
        await openWalletConnectPairingUri(nextPairingUri);
      } catch (openError) {
        setError(getErrorMessage(openError));
      }

      try {
        const session = await approval();
        setTopic(session.topic);
        setPublicKey(session.publicKey);
        setWalletName(session.walletName);
        setPairingUri(null);
        setError(null);
        setStatus('connected');

        const sessionChainIds = session.chainIds ?? [];
        setChainIds(sessionChainIds);

        const networkInfo = detectWalletNetwork(sessionChainIds);
        setWalletNetworkInfo(networkInfo);
        setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
      } catch (approvalError) {
        setError(getErrorMessage(approvalError));
        setStatus('error');
      }
    } catch (connectionError) {
      setError(getErrorMessage(connectionError));
      setStatus('error');
    }
  };

  const disconnectWallet = async () => {
    const activeTopic = topic;
    resetWalletState();

    if (!activeTopic) return;

    try {
      await disconnectWalletSession(activeTopic);
    } catch (disconnectError) {
      setError(getErrorMessage(disconnectError));
      setStatus('error');
    }
  };

  /**
   * Clears any restore or connection error and returns the wallet to idle.
   * Intended to be called from the WalletSessionBanner "Try Again" CTA or
   * from the NetworkGuardBanner "Reconnect Wallet" CTA.
   */
  const recoverSession = () => {
    resetWalletState();
    // Allow a subsequent successful restore to update restoreStatus again
    setRestoreStatus('none');
  };

  const reopenWallet = async () => {
    if (!pairingUri) return;

    try {
      await openWalletConnectPairingUri(pairingUri);
      setError(null);
    } catch (openError) {
      setError(getErrorMessage(openError));
      setStatus('error');
    }
  };

  const checkNetwork = () => {
    if (status === 'connected' && chainIds.length > 0) {
      const networkInfo = detectWalletNetwork(chainIds);
      setWalletNetworkInfo(networkInfo);
      setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
    }
  };

  return (
    <WalletContext.Provider
      value={{
        connectWallet,
        disconnectWallet,
        recoverSession,
        error,
        lastDeepLinkUrl,
        pairingUri,
        publicKey,
        reopenWallet,
        status,
        restoreStatus,
        walletName,
        chainIds,
        walletNetworkInfo,
        isOnCorrectNetwork,
        checkNetwork,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider.');
  }
  return context;
};
