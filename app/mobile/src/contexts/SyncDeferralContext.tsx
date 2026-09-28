import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import * as Battery from 'expo-battery';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METERED_OPT_IN_KEY = '@soter/metered-opt-in';
const FORCE_SYNC_OVERRIDE_KEY = '@soter/force-sync-override';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeferralReason = 
  | 'low-battery'
  | 'metered-connection'
  | 'large-upload'
  | 'none';

export interface SyncDeferralState {
  /** Current battery level (0-1), or -1 if unavailable */
  batteryLevel: number;
  /** Whether device is currently charging */
  isCharging: boolean;
  /** Whether current connection is metered (expensive) */
  isMetered: boolean;
  /** Whether user has opted in to sync on metered connections */
  meteredOptIn: boolean;
  /** Whether user has forced sync to bypass deferral */
  forceSyncOverride: boolean;
  /** Current deferral reason, if any */
  deferralReason: DeferralReason;
  /** Estimated upload size in bytes for current sync operation */
  estimatedUploadSize: number;
}

export interface SyncDeferralActions {
  /** Set whether user opts in to metered connection sync */
  setMeteredOptIn: (optIn: boolean) => Promise<void>;
  /** Force sync to bypass deferral temporarily */
  forceSync: () => Promise<void>;
  /** Clear force sync override */
  clearForceSync: () => Promise<void>;
  /** Set estimated upload size for the current operation */
  setEstimatedUploadSize: (size: number) => void;
  /** Check if an action should be deferred based on current conditions */
  shouldDeferAction: (actionType: string, isUrgent?: boolean) => { deferred: boolean; reason: DeferralReason };
  /** Get human-readable explanation of current deferral status */
  getDeferralExplanation: () => string;
}

export interface SyncDeferralContextValue extends SyncDeferralState, SyncDeferralActions {}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const defaultValue: SyncDeferralContextValue = {
  batteryLevel: -1,
  isCharging: false,
  isMetered: false,
  meteredOptIn: false,
  forceSyncOverride: false,
  deferralReason: 'none',
  estimatedUploadSize: 0,
  setMeteredOptIn: async () => {},
  forceSync: async () => {},
  clearForceSync: async () => {},
  setEstimatedUploadSize: () => {},
  shouldDeferAction: () => ({ deferred: false, reason: 'none' }),
  getDeferralExplanation: () => '',
};

const SyncDeferralContext = createContext<SyncDeferralContextValue>(defaultValue);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const SyncDeferralProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [batteryLevel, setBatteryLevel] = useState<number>(-1);
  const [isCharging, setIsCharging] = useState<boolean>(false);
  const [isMetered, setIsMetered] = useState<boolean>(false);
  const [meteredOptIn, setMeteredOptInState] = useState<boolean>(false);
  const [forceSyncOverride, setForceSyncOverrideState] = useState<boolean>(false);
  const [estimatedUploadSize, setEstimatedUploadSize] = useState<number>(0);

  // -----------------------------------------------------------------------
  // Load persisted preferences
  // -----------------------------------------------------------------------
  useEffect(() => {
    const loadPrefs = async () => {
      const [optInRaw, forceSyncRaw] = await Promise.all([
        AsyncStorage.getItem(METERED_OPT_IN_KEY),
        AsyncStorage.getItem(FORCE_SYNC_OVERRIDE_KEY),
      ]);
      if (optInRaw === 'true') setMeteredOptInState(true);
      if (forceSyncRaw === 'true') setForceSyncOverrideState(true);
    };
    void loadPrefs();
  }, []);

  // -----------------------------------------------------------------------
  // Battery monitoring
  // -----------------------------------------------------------------------
  useEffect(() => {
    const updateBatteryState = async () => {
      const level = await Battery.getBatteryLevelAsync();
      const state = await Battery.getBatteryStateAsync();
      setBatteryLevel(level);
      setIsCharging(state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL);
    };

    void updateBatteryState();

    const subscription = Battery.addBatteryStateListener(({ batteryLevel, batteryState }) => {
      setBatteryLevel(batteryLevel);
      setIsCharging(batteryState === Battery.BatteryState.CHARGING || batteryState === Battery.BatteryState.FULL);
    });

    return () => subscription.remove();
  }, []);

  // -----------------------------------------------------------------------
  // Network monitoring
  // -----------------------------------------------------------------------
  useEffect(() => {
    const checkNetwork = (state: NetInfoState) => {
      if (state.isConnected && state.details) {
        const metered = (state.details as Record<string, unknown>).isConnectionExpensive as boolean;
        setIsMetered(metered);
      } else {
        setIsMetered(false);
      }
    };

    void NetInfo.fetch().then(checkNetwork);
    const unsubscribe = NetInfo.addEventListener(checkNetwork);

    return () => unsubscribe();
  }, []);

  // -----------------------------------------------------------------------
  // Calculate deferral reason
  // -----------------------------------------------------------------------
  const deferralReason: DeferralReason = useMemo(() => {
    // Force sync override bypasses all deferrals
    if (forceSyncOverride) {
      return 'none';
    }

    // Low battery deferral (unless charging)
    const batteryThreshold = config.batteryThreshold ?? 0.2;
    if (!isCharging && batteryLevel >= 0 && batteryLevel < batteryThreshold) {
      return 'low-battery';
    }

    // Metered connection deferral for large uploads (unless opted in)
    const largeUploadThreshold = config.largeUploadThreshold ?? 5 * 1024 * 1024;
    if (isMetered && !meteredOptIn && estimatedUploadSize > largeUploadThreshold) {
      return 'large-upload';
    }

    // Metered connection deferral (unless opted in or allowed by config)
    if (isMetered && !meteredOptIn && !config.allowMeteredSync) {
      return 'metered-connection';
    }

    return 'none';
  }, [batteryLevel, isCharging, isMetered, meteredOptIn, forceSyncOverride, estimatedUploadSize]);

  // -----------------------------------------------------------------------
  // Public actions
  // -----------------------------------------------------------------------
  const setMeteredOptIn = useCallback(async (optIn: boolean) => {
    setMeteredOptInState(optIn);
    await AsyncStorage.setItem(METERED_OPT_IN_KEY, String(optIn));
  }, []);

  const forceSync = useCallback(async () => {
    setForceSyncOverrideState(true);
    await AsyncStorage.setItem(FORCE_SYNC_OVERRIDE_KEY, 'true');
    // Auto-clear after 5 minutes
    setTimeout(() => {
      void clearForceSync();
    }, 5 * 60 * 1000);
  }, []);

  const clearForceSync = useCallback(async () => {
    setForceSyncOverrideState(false);
    await AsyncStorage.removeItem(FORCE_SYNC_OVERRIDE_KEY);
  }, []);

  const shouldDeferAction = useCallback((actionType: string, isUrgent: boolean = false): { deferred: boolean; reason: DeferralReason } => {
    // Urgent items bypass all deferrals except force sync override
    if (isUrgent) {
      // Urgent items still respect low battery if not charging to preserve device
      const batteryThreshold = config.batteryThreshold ?? 0.2;
      if (!isCharging && batteryLevel >= 0 && batteryLevel < batteryThreshold) {
        return { deferred: true, reason: 'low-battery' };
      }
      return { deferred: false, reason: 'none' };
    }

    // Evidence uploads are considered large uploads
    const isLargeUpload = actionType === 'evidence-upload' && estimatedUploadSize > (config.largeUploadThreshold ?? 5 * 1024 * 1024);

    if (forceSyncOverride) {
      return { deferred: false, reason: 'none' };
    }

    // Low battery deferral
    const batteryThreshold = config.batteryThreshold ?? 0.2;
    if (!isCharging && batteryLevel >= 0 && batteryLevel < batteryThreshold) {
      return { deferred: true, reason: 'low-battery' };
    }

    // Large upload on metered connection deferral
    if (isMetered && !meteredOptIn && isLargeUpload) {
      return { deferred: true, reason: 'large-upload' };
    }

    // Metered connection deferral
    if (isMetered && !meteredOptIn && !config.allowMeteredSync) {
      return { deferred: true, reason: 'metered-connection' };
    }

    return { deferred: false, reason: 'none' };
  }, [batteryLevel, isCharging, isMetered, meteredOptIn, forceSyncOverride, estimatedUploadSize]);

  const getDeferralExplanation = useCallback((): string => {
    if (forceSyncOverride) {
      return 'Sync is active (force override enabled)';
    }

    if (deferralReason === 'low-battery') {
      const threshold = Math.round((config.batteryThreshold ?? 0.2) * 100);
      return `Sync deferred: Battery level (${Math.round(batteryLevel * 100)}%) is below ${threshold}% threshold${isCharging ? ' (charging)' : ''}`;
    }

    if (deferralReason === 'metered-connection') {
      return 'Sync deferred: Current connection is metered. Enable sync on metered connections in settings or use force sync.';
    }

    if (deferralReason === 'large-upload') {
      const thresholdMB = Math.round((config.largeUploadThreshold ?? 5 * 1024 * 1024) / (1024 * 1024));
      const uploadMB = Math.round(estimatedUploadSize / (1024 * 1024));
      return `Sync deferred: Large upload (${uploadMB}MB) on metered connection exceeds ${thresholdMB}MB threshold. Enable sync on metered connections in settings or use force sync.`;
    }

    return 'Sync is active';
  }, [deferralReason, batteryLevel, isCharging, forceSyncOverride, estimatedUploadSize]);

  // -----------------------------------------------------------------------
  // Context value
  // -----------------------------------------------------------------------
  const value = useMemo<SyncDeferralContextValue>(
    () => ({
      batteryLevel,
      isCharging,
      isMetered,
      meteredOptIn,
      forceSyncOverride,
      deferralReason,
      estimatedUploadSize,
      setMeteredOptIn,
      forceSync,
      clearForceSync,
      setEstimatedUploadSize,
      shouldDeferAction,
      getDeferralExplanation,
    }),
    [
      batteryLevel,
      isCharging,
      isMetered,
      meteredOptIn,
      forceSyncOverride,
      deferralReason,
      estimatedUploadSize,
      setMeteredOptIn,
      forceSync,
      clearForceSync,
      shouldDeferAction,
      getDeferralExplanation,
    ],
  );

  return (
    <SyncDeferralContext.Provider value={value}>
      {children}
    </SyncDeferralContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export const useSyncDeferral = () => useContext(SyncDeferralContext);
