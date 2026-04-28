import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAVER_MODE_KEY = '@soter/saver-mode';
const SAVER_AUTO_KEY = '@soter/saver-auto';

/**
 * Connection quality thresholds for auto-enabling saver mode.
 * If the measured download speed (when available) falls below this value
 * in Mbps, saver mode is automatically activated.
 */
const SLOW_SPEED_THRESHOLD_MBPS = 1.0;

/**
 * How often (ms) to re-check network quality when auto-detect is on.
 */
const NETWORK_CHECK_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SaverModeSource = 'manual' | 'auto' | 'off';

export interface SaverModeConfig {
  /** Whether saver mode is currently active (from any source) */
  active: boolean;
  /** What caused saver mode to be active: 'manual', 'auto', or 'off' */
  source: SaverModeSource;
  /** Whether auto-detect is enabled (user preference) */
  autoDetectEnabled: boolean;
  /** Last measured connection speed in Mbps (null if unavailable) */
  connectionSpeedMbps: number | null;
  /** Whether the current connection appears metered / expensive */
  isMetered: boolean;
  /** Toggle saver mode manually on/off */
  toggleManual: (enabled: boolean) => Promise<void>;
  /** Toggle auto-detect on/off */
  toggleAutoDetect: (enabled: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SaverModeContext = createContext<SaverModeConfig>({
  active: false,
  source: 'off',
  autoDetectEnabled: false,
  connectionSpeedMbps: null,
  isMetered: false,
  toggleManual: async () => {},
  toggleAutoDetect: async () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const SaverModeProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [manualEnabled, setManualEnabled] = useState(false);
  const [autoDetectEnabled, setAutoDetectEnabled] = useState(false);
  const [connectionSpeedMbps, setConnectionSpeedMbps] = useState<number | null>(null);
  const [isMetered, setIsMetered] = useState(false);
  const [autoTriggered, setAutoTriggered] = useState(false);

  // -----------------------------------------------------------------------
  // Persisted preferences
  // -----------------------------------------------------------------------
  useEffect(() => {
    const loadPrefs = async () => {
      const [manualRaw, autoRaw] = await Promise.all([
        AsyncStorage.getItem(SAVER_MODE_KEY),
        AsyncStorage.getItem(SAVER_AUTO_KEY),
      ]);
      if (manualRaw === 'true') setManualEnabled(true);
      if (autoRaw === 'true') setAutoDetectEnabled(true);
    };
    void loadPrefs();
  }, []);

  // -----------------------------------------------------------------------
  // Network quality monitoring (when auto-detect is on)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!autoDetectEnabled) {
      // Reset auto state when auto-detect is turned off
      setAutoTriggered(false);
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const checkNetwork = (state: NetInfoState) => {
      // When disconnected, details is null – nothing to check
      if (!state.isConnected || !state.details) {
        setAutoTriggered(false);
        return;
      }

      const metered = (state.details as Record<string, unknown>).isConnectionExpensive as boolean;
      setIsMetered(metered);

      // Estimate effective speed from the available connection metadata.
      // - WiFi provides `linkSpeed` (Mbps) on Android.
      // - Cellular provides `cellularGeneration` which we map to rough speeds.
      let speedMbps: number | null = null;
      if (state.type === 'wifi') {
        speedMbps = (state.details as Record<string, unknown>).linkSpeed as number | null ?? null;
      } else if (state.type === 'cellular') {
        const gen = (state.details as Record<string, unknown>).cellularGeneration as string | null;
        const generationSpeeds: Record<string, number> = {
          '2g': 0.1,
          '3g': 0.5,
          '4g': 10,
          '5g': 50,
        };
        speedMbps = gen ? (generationSpeeds[gen] ?? null) : null;
      }

      setConnectionSpeedMbps(speedMbps);

      // Auto-enable if on an expensive (metered) connection or slow speed
      const isSlow = speedMbps !== null && speedMbps < SLOW_SPEED_THRESHOLD_MBPS;
      const shouldActivate = metered || isSlow;

      setAutoTriggered(shouldActivate);
    };

    // Initial check
    void NetInfo.fetch().then(checkNetwork);

    // Subscribe for live updates
    const unsubscribe = NetInfo.addEventListener(checkNetwork);

    // Periodic re-check (NetInfo listener may not fire speed changes
    // on all platforms)
    intervalId = setInterval(() => {
      void NetInfo.fetch().then(checkNetwork);
    }, NETWORK_CHECK_INTERVAL_MS);

    return () => {
      unsubscribe();
      if (intervalId) clearInterval(intervalId);
    };
  }, [autoDetectEnabled]);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------
  const active = manualEnabled || autoTriggered;
  const source: SaverModeSource = manualEnabled
    ? 'manual'
    : autoTriggered
      ? 'auto'
      : 'off';

  // -----------------------------------------------------------------------
  // Public actions
  // -----------------------------------------------------------------------
  const toggleManual = useCallback(async (enabled: boolean) => {
    setManualEnabled(enabled);
    await AsyncStorage.setItem(SAVER_MODE_KEY, String(enabled));
  }, []);

  const toggleAutoDetect = useCallback(async (enabled: boolean) => {
    setAutoDetectEnabled(enabled);
    await AsyncStorage.setItem(SAVER_AUTO_KEY, String(enabled));
  }, []);

  // -----------------------------------------------------------------------
  // Context value
  // -----------------------------------------------------------------------
  const value = useMemo<SaverModeConfig>(
    () => ({
      active,
      source,
      autoDetectEnabled,
      connectionSpeedMbps,
      isMetered,
      toggleManual,
      toggleAutoDetect,
    }),
    [active, source, autoDetectEnabled, connectionSpeedMbps, isMetered, toggleManual, toggleAutoDetect],
  );

  return (
    <SaverModeContext.Provider value={value}>
      {children}
    </SaverModeContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export const useSaverMode = () => useContext(SaverModeContext);
