import React, {
  PropsWithChildren,
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { AidDetails } from '../services/aidApi';
import {
  QueuedSyncAction,
  SyncActionSuccessEvent,
  SyncQueueState,
  clearSyncQueue as clearSyncQueueService,
  discardAction as discardQueueAction,
  dispatchNetworkAction,
  flushPendingNetworkActions,
  getSyncQueueState,
  requeueAction as requeueQueueAction,
  retryFailedAction,
  subscribeToSyncQueue,
  subscribeToSyncSuccess,
} from '../services/syncQueue';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useSaverMode } from './SaverModeContext';
import {
  useSyncDeferral,
  SyncFrequency,
  SYNC_FREQUENCY_INTERVALS,
} from './SyncDeferralContext';

interface SyncContextValue extends SyncQueueState {
  isConnected: boolean;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  lastCompletedAction: SyncActionSuccessEvent | null;
  flushNow: (force?: boolean) => Promise<void>;
  queueStatusRefresh: (aidId: string, urgent?: boolean) => Promise<
    { status: 'completed'; result: AidDetails } | { status: 'queued'; action: QueuedSyncAction }
  >;
  queueClaimConfirmation: (aidId: string, claimId: string, urgent?: boolean) => Promise<
    { status: 'completed'; result: unknown } | { status: 'queued'; action: QueuedSyncAction }
  >;
  queueEvidenceUpload: (
    aidId: string,
    upload: {
      url: string;
      method?: 'POST' | 'PUT' | 'PATCH';
      headers?: Record<string, string>;
      body?: string;
      estimatedSize?: number;
    },
    urgent?: boolean,
  ) => Promise<
    { status: 'completed'; result: unknown } | { status: 'queued'; action: QueuedSyncAction }
  >;
  queueClaimSubmission: (aidId: string, claimId: string, idempotencyKey: string, urgent?: boolean) => Promise<
    { status: 'completed'; result: unknown } | { status: 'queued'; action: QueuedSyncAction }
  >;
  retryAction: (actionId: string) => Promise<void>;
  requeueAction: (actionId: string) => Promise<void>;
  discardAction: (actionId: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  getActionsForAid: (aidId: string) => QueuedSyncAction[];
  forceSync: () => Promise<void>;
  deferralExplanation: string;
  syncFrequency: SyncFrequency;
  setSyncFrequency: (frequency: SyncFrequency) => Promise<void>;
}

const defaultValue: SyncContextValue = {
  items: [],
  isSyncing: false,
  lastSyncAt: null,
  lastSyncError: null,
  isConnected: true,
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  lastCompletedAction: null,
  flushNow: async () => {},
  queueStatusRefresh: async () => ({ status: 'queued', action: {} as QueuedSyncAction }),
  queueClaimConfirmation: async () => ({ status: 'queued', action: {} as QueuedSyncAction }),
  queueEvidenceUpload: async () => ({ status: 'queued', action: {} as QueuedSyncAction }),
  queueClaimSubmission: async () => ({ status: 'queued', action: {} as QueuedSyncAction }),
  retryAction: async () => {},
  requeueAction: async () => {},
  discardAction: async () => {},
  clearQueue: async () => {},
  getActionsForAid: () => [],
  forceSync: async () => {},
  deferralExplanation: '',
  syncFrequency: 'normal',
  setSyncFrequency: async () => {},
};

const SyncContext = createContext<SyncContextValue>(defaultValue);

export const SyncProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [syncState, setSyncState] = useState<SyncQueueState>({
    items: [],
    isSyncing: false,
    lastSyncAt: null,
    lastSyncError: null,
  });
  const [lastCompletedAction, setLastCompletedAction] = useState<SyncActionSuccessEvent | null>(null);
  const handleReconnect = useCallback(async () => {
    await flushPendingNetworkActions({ online: true });
  }, []);
  const { isConnected } = useNetworkStatus(handleReconnect);
  const { active: saverModeActive } = useSaverMode();
  const { 
    batteryLevel, 
    isCharging, 
    isMetered, 
    meteredOptIn, 
    forceSync: forceSyncDeferral, 
    clearForceSync,
    getDeferralExplanation,
    setEstimatedUploadSize,
    syncFrequency,
    setSyncFrequency,
  } = useSyncDeferral();

  const flushNow = useCallback(async (force: boolean = false) => {
    if (force) {
      await forceSyncDeferral();
    }
    await flushPendingNetworkActions({ 
      online: isConnected, 
      saverMode: saverModeActive,
      forceSync: force,
      batteryLevel,
      isCharging,
      isMetered,
      meteredOptIn,
    });
  }, [isConnected, saverModeActive, forceSyncDeferral, batteryLevel, isCharging, isMetered, meteredOptIn]);

  useEffect(() => {
    void getSyncQueueState().then(setSyncState);

    const unsubscribeQueue = subscribeToSyncQueue(setSyncState);
    const unsubscribeSuccess = subscribeToSyncSuccess((event) => {
      setLastCompletedAction(event);
    });

    return () => {
      unsubscribeQueue();
      unsubscribeSuccess();
    };
  }, []);

  // Periodic background sync based on syncFrequency
  useEffect(() => {
    if (!isConnected || saverModeActive) {
      return;
    }

    const intervalMs =
      SYNC_FREQUENCY_INTERVALS[syncFrequency] ?? SYNC_FREQUENCY_INTERVALS.normal;
    const intervalId = setInterval(() => {
      void flushNow();
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [flushNow, isConnected, saverModeActive, syncFrequency]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isConnected) {
        // In saver mode, skip the automatic flush when returning to the app
        // to reduce background data usage. The user can still pull-to-refresh.
        if (!saverModeActive) {
          if (syncFrequency === 'conservative' && syncState.lastSyncAt) {
            const elapsed = Date.now() - new Date(syncState.lastSyncAt).getTime();
            if (elapsed < SYNC_FREQUENCY_INTERVALS.conservative) {
              return;
            }
          }
          void flushNow();
        }
      }
    });

    return () => subscription.remove();
  }, [flushNow, isConnected, saverModeActive, syncFrequency, syncState.lastSyncAt]);

  useEffect(() => {
    // In saver mode, don't auto-flush on mount/reconnect – let the user
    // explicitly trigger refreshes to save data.
    if (isConnected && !saverModeActive) {
      if (syncFrequency === 'conservative' && syncState.lastSyncAt) {
        const elapsed = Date.now() - new Date(syncState.lastSyncAt).getTime();
        if (elapsed < SYNC_FREQUENCY_INTERVALS.conservative) {
          return;
        }
      }
      void flushNow();
    }
  }, [flushNow, isConnected, saverModeActive, syncFrequency, syncState.lastSyncAt]);

  // Clear force sync override when component unmounts
  useEffect(() => {
    return () => {
      void clearForceSync();
    };
  }, [clearForceSync]);

  const value = useMemo<SyncContextValue>(() => {
    const pendingCount = syncState.items.filter(
      (item) => item.state === 'pending' || item.state === 'retrying',
    ).length;
    const failedCount = syncState.items.filter((item) => item.state === 'failed').length;
    const conflictCount = syncState.items.filter((item) => item.state === 'conflict').length;

    return {
      ...syncState,
      isConnected,
      pendingCount,
      failedCount,
      conflictCount,
      lastCompletedAction,
      flushNow,
      queueStatusRefresh: (aidId: string, urgent: boolean = false) =>
        dispatchNetworkAction({ type: 'status-refresh', payload: { aidId, urgent } }, { online: isConnected }),
      queueClaimConfirmation: (aidId: string, claimId: string, urgent: boolean = false) =>
        dispatchNetworkAction(
          { type: 'claim-confirmation', payload: { aidId, claimId, urgent } },
          { online: isConnected },
        ),
      queueEvidenceUpload: (aidId, upload, urgent: boolean = false) => {
        if (upload.estimatedSize) {
          setEstimatedUploadSize(upload.estimatedSize);
        }
        return dispatchNetworkAction(
          {
            type: 'evidence-upload',
            payload: {
              aidId,
              ...upload,
              urgent,
              estimatedSize: upload.estimatedSize,
            },
          },
          { online: isConnected },
        );
      },
      queueClaimSubmission: (aidId: string, claimId: string, idempotencyKey: string, urgent: boolean = false) =>
        dispatchNetworkAction(
          { type: 'claim-submission', payload: { aidId, claimId, idempotencyKey, urgent } },
          { online: isConnected },
        ),
      retryAction: async (actionId: string) => {
        await retryFailedAction(actionId);
        await flushPendingNetworkActions({ 
          online: isConnected, 
          saverMode: saverModeActive,
          batteryLevel,
          isCharging,
          isMetered,
          meteredOptIn,
        });
      },
      requeueAction: async (actionId: string) => {
        await requeueQueueAction(actionId);
        await flushPendingNetworkActions({ 
          online: isConnected, 
          saverMode: saverModeActive,
          batteryLevel,
          isCharging,
          isMetered,
          meteredOptIn,
        });
      },
      discardAction: async (actionId: string) => {
        await discardQueueAction(actionId);
      },
      clearQueue: async () => {
        await clearSyncQueueService();
      },
      getActionsForAid: (aidId: string) =>
        syncState.items.filter((item) => {
          const payload = item.payload as { aidId?: string };
          return payload.aidId === aidId;
        }),
      forceSync: async () => {
        await flushNow(true);
      },
      deferralExplanation: getDeferralExplanation(),
      syncFrequency,
      setSyncFrequency,
    };
  }, [
    flushNow, 
    isConnected, 
    lastCompletedAction, 
    saverModeActive, 
    syncState,
    batteryLevel,
    isCharging,
    isMetered,
    meteredOptIn,
    forceSyncDeferral,
    clearForceSync,
    getDeferralExplanation,
    setEstimatedUploadSize,
    syncFrequency,
    setSyncFrequency,
  ]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export const useSync = () => useContext(SyncContext);
