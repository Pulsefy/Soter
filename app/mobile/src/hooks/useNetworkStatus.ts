import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

/**
 * Monitors network connectivity using @react-native-community/netinfo.
 * Returns live connection state and fires `onReconnect` when connectivity is restored.
 */
export const useNetworkStatus = (
  onReconnect?: () => void | Promise<void>,
): NetworkStatus => {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect(() => {
    let wasOffline = false;

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = state.isConnected ?? false;
      const reachable = state.isInternetReachable ?? null;

      setStatus({ isConnected: connected, isInternetReachable: reachable });

      // Fire sync callback when coming back online
      if (wasOffline && connected && onReconnect) {
        onReconnect();
      }

      wasOffline = !connected;
    });

    return () => unsubscribe();
  }, [onReconnect]);

  return status;
};
