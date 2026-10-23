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

type NetworkStatusCallback = () => void | Promise<void>;

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
 * Returns live connection state and fires:
 *   - `onReconnect` when connectivity is restored after being offline
 *   - `onNetworkChange` when the network interface type changes while still
 *     connected (e.g. WiFi → cellular). This lets in-flight uploads that
 *     were aborted by the interface switch resume from their last saved chunk
 *     rather than restarting from zero.
 */
export const useNetworkStatus = (
  onReconnect?: NetworkStatusCallback,
  onNetworkChange?: NetworkStatusCallback,
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
    let previousType: string | null = null;
    // Guard against spurious type-change events emitted by Android emulators
    // during app startup (e.g. 'unknown' → 'wifi' while already connected).
    // We only start tracking type changes after the first stable connected
    // event has been observed, so the very first NetInfo callback — which
    // merely reports the current state — never triggers onNetworkChange.
    let wasConnectedOnce = false;

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

      if (wasOffline && connected) {
        // Connectivity restored after a drop — resume any queued uploads.
        if (onReconnect) {
          onReconnect();
        }
      } else if (
        connected &&
        wasConnectedOnce &&
        previousType !== null &&
        state.type !== previousType &&
        onNetworkChange
      ) {
        // Network type changed while remaining connected (e.g. WiFi → cellular).
        // In-flight fetches will have been aborted by the OS; trigger a flush so
        // partially-uploaded evidence sessions resume from the last committed chunk
        // rather than restarting from scratch.
        onNetworkChange();
      }

      wasOffline = !connected;
      // Only track the type while connected; clearing when offline avoids
      // treating reconnect-on-different-interface as a type-change event.
      if (connected) {
        previousType = state.type;
        wasConnectedOnce = true;
      }
    });

    return () => unsubscribe();
  }, [onReconnect, onNetworkChange]);

  return {
    ...status,
    recordRequestOutcome,
  };
};
