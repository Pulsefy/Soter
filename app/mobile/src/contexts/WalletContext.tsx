import React, { PropsWithChildren, createContext, useContext, useEffect, useState } from 'react';
import * as ExpoLinking from 'expo-linking';
import {
  ConnectedWalletSession,
  WalletConnectionStatus,
  createWalletConnection,
  disconnectWalletSession,
  getWalletConnectChainId,
  openWalletConnectPairingUri,
  restoreWalletSession,
} from '../services/walletConnect';
import { detectNetworkMismatch } from '../services/NetworkGuard';

interface WalletContextValue {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  error: string | null;
  lastDeepLinkUrl: string | null;
  networkMismatch: boolean;
  pairingUri: string | null;
  publicKey: string | null;
  reopenWallet: () => Promise<void>;
  sessionChainIds: string[];
  status: WalletConnectionStatus;
  walletName: string | null;
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
  networkMismatch: false,
  pairingUri: null,
  publicKey: null,
  sessionChainIds: [] as string[],
  status: 'idle' as WalletConnectionStatus,
  walletName: null,
};

export const WalletProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [status, setStatus] = useState<WalletConnectionStatus>('idle');
  const [topic, setTopic] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [pairingUri, setPairingUri] = useState<string | null>(null);
  const [lastDeepLinkUrl, setLastDeepLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionChainIds, setSessionChainIds] = useState<string[]>([]);
  const [networkMismatch, setNetworkMismatch] = useState(false);

  /**
   * Recomputes and stores network guard state from a session's chain IDs.
   * Called on connect, restore, and implicitly cleared on disconnect.
   */
  const applyNetworkGuard = (chainIds: string[]) => {
    setSessionChainIds(chainIds);
    setNetworkMismatch(detectNetworkMismatch(chainIds, getWalletConnectChainId()));
  };

  useEffect(() => {
    let isMounted = true;

    const applyConnectedSession = (session: ConnectedWalletSession) => {
      if (!isMounted) {
        return;
      }

      setTopic(session.topic);
      setPublicKey(session.publicKey);
      setWalletName(session.walletName);
      setPairingUri(null);
      setError(null);
      setStatus('connected');
      applyNetworkGuard(session.chainIds);
    };

    const bootstrap = async () => {
      try {
        const existingSession = await restoreWalletSession();
        if (existingSession) {
          applyConnectedSession(existingSession);
        }
      } catch (sessionError) {
        if (isMounted) {
          setError(getErrorMessage(sessionError));
          setStatus('error');
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

  const resetWalletState = () => {
    setTopic(null);
    setPublicKey(idleState.publicKey);
    setWalletName(idleState.walletName);
    setPairingUri(idleState.pairingUri);
    setError(idleState.error);
    setStatus(idleState.status);
    setSessionChainIds(idleState.sessionChainIds);
    setNetworkMismatch(idleState.networkMismatch);
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
        applyNetworkGuard(session.chainIds);
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

    if (!activeTopic) {
      return;
    }

    try {
      await disconnectWalletSession(activeTopic);
    } catch (disconnectError) {
      setError(getErrorMessage(disconnectError));
      setStatus('error');
    }
  };

  const reopenWallet = async () => {
    if (!pairingUri) {
      return;
    }

    try {
      await openWalletConnectPairingUri(pairingUri);
      setError(null);
    } catch (openError) {
      setError(getErrorMessage(openError));
      setStatus('error');
    }
  };

  return (
    <WalletContext.Provider
      value={{
        connectWallet,
        disconnectWallet,
        error,
        lastDeepLinkUrl,
        networkMismatch,
        pairingUri,
        publicKey,
        reopenWallet,
        sessionChainIds,
        status,
        walletName,
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
