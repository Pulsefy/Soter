import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type NetworkQualityState = 'good' | 'degraded' | 'offline';

export interface NetworkRequestSample {
  latencyMs?: number | null;
  failed?: boolean | null;
}

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  networkQuality: NetworkQualityState;
}

export const evaluateNetworkQuality = (samples: NetworkRequestSample[]): NetworkQualityState => {
  const recent = samples.filter(
    (sample) => sample && (typeof sample.latencyMs === 'number' || typeof sample.failed === 'boolean'),
  );

  if (!recent.length) {
    return 'good';
  }

  const latencySamples = recent
    .map((sample) => sample.latencyMs)
    .filter((latency): latency is number => typeof latency === 'number' && Number.isFinite(latency));

  const averageLatency =
    latencySamples.length > 0
      ? latencySamples.reduce((total, latency) => total + latency, 0) / latencySamples.length
      : 0;

  const failureRate = recent.filter((sample) => sample.failed === true).length / recent.length;

  if (averageLatency >= 4000 || failureRate >= 0.25 || latencySamples.some((latency) => latency >= 7000)) {
    return 'degraded';
  }

  return 'good';
};

/**
 * Monitors network connectivity using @react-native-community/netinfo.
 * Returns live connection state and fires `onReconnect` when connectivity is restored.
 */
export const useNetworkStatus = (
  onReconnect?: () => void | Promise<void>,
): NetworkStatus & { recordRequestOutcome: (latencyMs?: number | null, failed?: boolean) => void } => {
  const sampleWindowRef = useRef<NetworkRequestSample[]>([]);
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
    networkQuality: 'good',
  });

  const recordRequestOutcome = useCallback((latencyMs?: number | null, failed = false) => {
    const nextSample: NetworkRequestSample = {
      latencyMs,
      failed,
    };

    const nextSamples = [...sampleWindowRef.current, nextSample].slice(-12);
    sampleWindowRef.current = nextSamples;

    setStatus((current) => ({
      ...current,
      networkQuality: current.isConnected ? evaluateNetworkQuality(nextSamples) : 'offline',
    }));
  }, []);

  useEffect(() => {
    let wasOffline = false;

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = state.isConnected ?? false;
      const reachable = state.isInternetReachable ?? null;
      const nextQuality = connected ? evaluateNetworkQuality(sampleWindowRef.current) : 'offline';

      setStatus((current) => ({
        ...current,
        isConnected: connected,
        isInternetReachable: reachable,
        networkQuality: nextQuality,
      }));

      // Fire sync callback when coming back online
      if (wasOffline && connected && onReconnect) {
        onReconnect();
      }

      wasOffline = !connected;
    });

    return () => unsubscribe();
  }, [onReconnect]);

  return {
    ...status,
    recordRequestOutcome,
  };
};
