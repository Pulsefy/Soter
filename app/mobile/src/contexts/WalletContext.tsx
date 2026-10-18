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
import { confirmValueMovingAction } from '../services/valueActionConfirmation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { detectWalletNetwork, WalletNetworkInfo } from '../services/networkGuard';
import {
  migrateFromAsyncStorage,
  secureClearAll,
} from '../services/secureStorage';

/**
 * Lifecycle state of the session-restore bootstrap.
 *
 * - 'restoring'           The provider is currently calling restoreWalletSession on mount.
 * - 'restored'            A persisted session was found and rehydrated successfully.
 * - 'none'                Bootstrap completed but no stored session was found.
 * - 'failed'              Bootstrap threw an error; the session could not be restored.
 * - 'secure_unavailable'  The platform Keychain / Keystore was inaccessible during
 *                         restore. The user must re-authenticate to unlock the secure
 *                         enclave before a session can be recovered.
 */
export type RestoreStatus = 'restoring' | 'restored' | 'none' | 'failed' | 'secure_unavailable';

interface WalletContextValue {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  /**
   * Clears a 'failed' restore or connect error and resets the wallet to idle,
   * allowing the user to attempt a fresh connection.
   */
  recoverSession: () => void;
  /**
   * Triggers a re-authentication flow when secure storage is unavailable.
   * On success the bootstrap is retried. On failure the wallet stays locked.
   */
  reauthenticate: () => Promise<void>;
  error: string | null;
  lastDeepLinkUrl: string | null;
  pairingUri: string | null;
  publicKey: string | null;
  reopenWallet: () => Promise<void>;
  status: WalletConnectionStatus;
  /** Lifecycle state of the on-mount session-restore bootstrap. */
  restoreStatus: RestoreStatus;
  /**
   * True when secure storage is unavailable and the user must unlock the
   * device before session material can be accessed.
   */
  secureStorageUnavailable: boolean;
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
  const [secureStorageUnavailable, setSecureStorageUnavailable] = useState(false);
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
      // Run one-shot migration from AsyncStorage → secure storage before any
      // session restore attempt.  This is a no-op on subsequent launches.
      try {
        await migrateFromAsyncStorage();
      } catch {
        // Migration failures are non-fatal — the restore proceeds regardless.
      }

      try {
        const existingSession = await restoreWalletSession();
        if (isMounted) {
          if (existingSession) {
            applyConnectedSession(existingSession);
            setRestoreStatus('restored');
            setSecureStorageUnavailable(false);
          } else {
            setRestoreStatus('none');
            setSecureStorageUnavailable(false);
          }
        }
      } catch (sessionError) {
        if (!isMounted) return;

        // Detect whether the error originated from a secure storage failure.
        // Any error whose message contains "secure" or "keychain/keystore"
        // keywords, or the SecureStorageUnavailableError type, is treated as a
        // hardware-level lockout that requires the user to re-authenticate.
        const msg = sessionError instanceof Error ? sessionError.message : '';
        const isSecureFailure =
          sessionError?.constructor?.name === 'SecureStorageUnavailableError' ||
          /secure|keychain|keystore|enclave/i.test(msg);

        if (isSecureFailure) {
          setSecureStorageUnavailable(true);
          setRestoreStatus('secure_unavailable');
          setStatus('error');
          setError(
            'Wallet credentials are locked. Please unlock your device and try again.',
          );
        } else {
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
    setSecureStorageUnavailable(false);
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

    const confirmationResult = await confirmValueMovingAction('Confirm wallet disconnect');
    if (!confirmationResult.ok) {
      if (confirmationResult.reason === 'cancelled') {
        return;
      }
      setError('Biometric confirmation failed. Please try again.');
      return;
    }

    resetWalletState();

    // Purge all wallet session material from secure storage on explicit
    // disconnect so a future re-pair starts from a clean state.
    try {
      await secureClearAll();
    } catch {
      // Non-fatal — the WalletConnect session is already invalidated locally.
    }

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

  /**
   * Re-authentication flow for when secure storage is unavailable.
   *
   * Prompts the user for biometric / passcode confirmation then retries the
   * session restore.  If the re-authentication succeeds the wallet provider
   * boots as if the device had just been unlocked.  If it fails (user
   * cancels or hardware error) the wallet stays in 'secure_unavailable'.
   */
  const reauthenticate = async () => {
    // Ask the user to authenticate via biometric / device passcode.
    const confirmationResult = await confirmValueMovingAction(
      'Unlock your wallet to continue',
    );

    if (!confirmationResult.ok) {
      // User cancelled — keep the secure_unavailable state so the banner
      // remains visible without overwriting the current error message.
      return;
    }

    // Authentication succeeded — retry the session restore.
    setRestoreStatus('restoring');
    setError(null);
    setSecureStorageUnavailable(false);
    setStatus('idle');

    try {
      const existingSession = await restoreWalletSession();
      if (existingSession) {
        setTopic(existingSession.topic);
        setPublicKey(existingSession.publicKey);
        setWalletName(existingSession.walletName);
        setPairingUri(null);
        setError(null);
        setStatus('connected');

        const sessionChainIds = existingSession.chainIds ?? [];
        setChainIds(sessionChainIds);

        const networkInfo = detectWalletNetwork(sessionChainIds);
        setWalletNetworkInfo(networkInfo);
        setIsOnCorrectNetwork(networkInfo.isKnown && networkInfo.isTestnet);
        setRestoreStatus('restored');
      } else {
        setRestoreStatus('none');
      }
    } catch (sessionError) {
      setError(getErrorMessage(sessionError));
      setStatus('error');
      setRestoreStatus('failed');
    }
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
        reauthenticate,
        error,
        lastDeepLinkUrl,
        pairingUri,
        publicKey,
        reopenWallet,
        status,
        restoreStatus,
        secureStorageUnavailable,
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
