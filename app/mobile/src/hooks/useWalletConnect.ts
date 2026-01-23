import { useState, useEffect, useCallback } from 'react';
import { walletConnectService, WalletSession } from '../services/walletConnect';

export interface UseWalletConnectReturn {
  session: WalletSession | null;
  publicKey: string | undefined;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<string>;
  waitForSession: () => Promise<void>;
  disconnect: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useWalletConnect = (): UseWalletConnectReturn => {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Set up session update callback
    walletConnectService.setOnSessionUpdate(setSession);

    // Restore existing sessions on mount
    walletConnectService.restoreSessions().catch((err) => {
      console.error('Failed to restore sessions:', err);
    });

    return () => {
      walletConnectService.setOnSessionUpdate(() => {});
    };
  }, []);

  const initialize = useCallback(async () => {
    try {
      setError(null);
      await walletConnectService.initialize();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize wallet';
      setError(errorMessage);
      throw err;
    }
  }, []);

  const connect = useCallback(async (): Promise<string> => {
    try {
      setError(null);
      setIsConnecting(true);
      const uri = await walletConnectService.createConnection();
      return uri;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create connection';
      setError(errorMessage);
      setIsConnecting(false);
      throw err;
    }
  }, []);

  const waitForSession = useCallback(async () => {
    try {
      setError(null);
      setIsConnecting(true);
      await walletConnectService.waitForSession();
      setIsConnecting(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(errorMessage);
      setIsConnecting(false);
      throw err;
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      setError(null);
      await walletConnectService.disconnect();
      setSession(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect wallet';
      setError(errorMessage);
    }
  }, []);

  return {
    session,
    publicKey: walletConnectService.getPublicKey(),
    isConnecting,
    error,
    connect,
    waitForSession,
    disconnect,
    initialize,
  };
};

