import { useWallet } from '../contexts/WalletContext';
import type { RestoreStatus } from '../contexts/WalletContext';

export interface WalletSessionState {
  /**
   * True while the on-mount session-restore bootstrap is running.
   * Use this to gate loading spinners or skeleton screens.
   */
  isRestoring: boolean;

  /**
   * True once a persisted session was found and rehydrated without error.
   */
  isRestored: boolean;

  /**
   * True when the bootstrap threw and no usable session could be loaded.
   * Surface a recovery CTA to the user when this is true.
   */
  restoreFailed: boolean;

  /**
   * True when no stored session was found but no error occurred either.
   * The app is in a clean idle state waiting for the user to connect.
   */
  noSession: boolean;

  /**
   * Raw restore lifecycle status for cases that need fine-grained control.
   */
  restoreStatus: RestoreStatus;

  /**
   * The error message from the failed restore, if any.
   */
  sessionError: string | null;

  /**
   * Clears any restore or connection error and returns the wallet to idle,
   * allowing the user to attempt a fresh connection.
   */
  recoverSession: () => void;

  /**
   * True when a wallet is currently connected and the session is valid.
   */
  isConnected: boolean;

  /**
   * The connected wallet's public key, or null when not connected.
   */
  publicKey: string | null;

  /**
   * The connected wallet's display name (e.g. "Lobstr", "Beans"), or null.
   */
  walletName: string | null;
}

/**
 * Encapsulates wallet session-restore lifecycle into a single, easy-to-consume
 * hook. Prefer this over composing useWallet + restoreStatus manually in screens.
 *
 * @example
 * ```tsx
 * const { isRestoring, restoreFailed, recoverSession, isConnected } = useWalletSession();
 *
 * if (isRestoring) return <LoadingOverlay />;
 * if (restoreFailed) return <WalletSessionBanner />;
 * if (!isConnected) return <ConnectPrompt />;
 * ```
 */
export const useWalletSession = (): WalletSessionState => {
  const {
    restoreStatus,
    error,
    recoverSession,
    status,
    publicKey,
    walletName,
  } = useWallet();

  return {
    isRestoring: restoreStatus === 'restoring',
    isRestored: restoreStatus === 'restored',
    restoreFailed: restoreStatus === 'failed',
    noSession: restoreStatus === 'none',
    restoreStatus,
    sessionError: restoreStatus === 'failed' ? (error ?? 'Session restore failed.') : null,
    recoverSession,
    isConnected: status === 'connected',
    publicKey,
    walletName,
  };
};
