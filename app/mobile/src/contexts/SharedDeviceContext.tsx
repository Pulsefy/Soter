import React, {
  PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWallet } from './WalletContext';

const STORAGE_KEY = 'shared_device_mode_enabled';
const GRACE_PERIOD_MS = 5000; // 5 seconds grace period for accidental app switches

interface SharedDeviceContextValue {
  /** Whether shared device mode is currently enabled */
  enabled: boolean;
  /** Toggle shared device mode on/off. Persists the choice. */
  toggle: (enabled: boolean) => Promise<void>;
}

const SharedDeviceContext = createContext<SharedDeviceContextValue>({
  enabled: false,
  toggle: async () => {},
});

/**
 * Provides shared device mode state to the entire component tree.
 *
 * When enabled, this context monitors app state changes and automatically
 * clears the wallet session when the app is backgrounded beyond a short
 * grace period. This is intended for field devices shared between workers.
 */
export const SharedDeviceProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const [enabled, setEnabled] = useState(false);
  const { disconnectWallet, status } = useWallet();
  const backgroundTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bootstrap: read preference from storage
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (mounted) {
          setEnabled(stored === 'true');
        }
      } catch {
        // If storage read fails, default to disabled
        if (mounted) {
          setEnabled(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Monitor app state and clear session when backgrounded (if enabled)
  useEffect(() => {
    if (!enabled) return;

    const handleAppStateChange = (nextAppState: string) => {
      // Clear any existing timeout when app state changes
      if (backgroundTimeoutRef.current) {
        clearTimeout(backgroundTimeoutRef.current);
        backgroundTimeoutRef.current = null;
      }

      // If app goes to background/inactive and wallet is connected, start grace period
      if (
        (nextAppState === 'background' || nextAppState === 'inactive') &&
        status === 'connected'
      ) {
        backgroundTimeoutRef.current = setTimeout(() => {
          // Grace period elapsed - clear the session
          void disconnectWallet();
        }, GRACE_PERIOD_MS);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      if (backgroundTimeoutRef.current) {
        clearTimeout(backgroundTimeoutRef.current);
      }
    };
  }, [enabled, status, disconnectWallet]);

  const toggle = async (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    await AsyncStorage.setItem(STORAGE_KEY, nextEnabled ? 'true' : 'false');
  };

  return (
    <SharedDeviceContext.Provider value={{ enabled, toggle }}>
      {children}
    </SharedDeviceContext.Provider>
  );
};

export const useSharedDevice = (): SharedDeviceContextValue => {
  const ctx = useContext(SharedDeviceContext);
  if (!ctx) {
    throw new Error('useSharedDevice must be used within a SharedDeviceProvider');
  }
  return ctx;
};
