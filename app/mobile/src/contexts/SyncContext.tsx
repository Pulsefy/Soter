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
  dispatchNetworkAction,
  flushPendingNetworkActions,
  getSyncQueueState,
  subscribeToSyncQueue,
  subscribeToSyncSuccess,
} from '../services/syncQueue';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useSaverMode } from './SaverModeContext';

interface SyncContextValue extends SyncQueueState {
  isConnected: boolean;
  pendingCount: number;
  failedCount: number;
  lastCompletedAction: SyncActionSuccessEvent | null;
  flushNow: () => Promise<void>;
  queueStatusRefresh: (aidId: string) => Promise<
    { status: 'completed'; result: AidDetails } | { status: 'queued'; action: QueuedSyncAction }
  >;
  queueClaimConfirmation: (aidId: string, claimId: string) => Promise<
    { status: 'completed'; result: unknown } | { status: 'queued'; action: QueuedSyncAction }
  >;
  queueEvidenceUpload: (
    aidId: string,
    upload: {
      url: string;
      method?: 'POST' | 'PUT' | 'PATCH';
      headers?: Record<string, string>;
      body?: string;
    },
  ) => Promise<
    { status: 'completed'; result: unknown } | { status: 'queued'; action: QueuedSyncAction }
  >;
  getActionsForAid: (aidId: string) => QueuedSyncAction[];
}

const defaultValue: SyncContextValue = {
  items: [],
  isSyncing: false,
  lastSyncAt: null,
  lastSyncError: null,
  isConnected: true,
  pendingCount: 0,
  failedCount: 0,
  lastCompletedAction: null,
  flushNow: async () => {},
  queueStatusRefresh: async () => ({ status: 'queued', action: {} as QueuedSyncAction }),
  queueClaimConfirmation: async () => ({ status: 'queued', action: {} as QueuedSyncAction }),
  queueEvidenceUpload: async () => ({ status: 'queued', action: {} as QueuedSyncAction }),
  getActionsForAid: () => [],
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

  const flushNow = useCallback(async () => {
    await flushPendingNetworkActions({ online: isConnected, saverMode: saverModeActive });
  }, [isConnected, saverModeActive]);

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

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isConnected) {
        // In saver mode, skip the automatic flush when returning to the app
        // to reduce background data usage. The user can still pull-to-refresh.
        if (!saverModeActive) {
          void flushNow();
        }
      }
    });

    return () => subscription.remove();
  }, [flushNow, isConnected, saverModeActive]);

  useEffect(() => {
    // In saver mode, don't auto-flush on mount/reconnect – let the user
    // explicitly trigger refreshes to save data.
    if (isConnected && !saverModeActive) {
      void flushNow();
    }
  }, [flushNow, isConnected, saverModeActive]);

  const value = useMemo<SyncContextValue>(() => {
    const pendingCount = syncState.items.filter((item) => item.state !== 'failed').length;
    const failedCount = syncState.items.filter((item) => item.state === 'failed').length;

    return {
      ...syncState,
      isConnected,
      pendingCount,
      failedCount,
      lastCompletedAction,
      flushNow,
      queueStatusRefresh: (aidId: string) =>
        dispatchNetworkAction({ type: 'status-refresh', payload: { aidId } }, { online: isConnected }),
      queueClaimConfirmation: (aidId: string, claimId: string) =>
        dispatchNetworkAction(
          { type: 'claim-confirmation', payload: { aidId, claimId } },
          { online: isConnected },
        ),
      queueEvidenceUpload: (aidId, upload) =>
        dispatchNetworkAction(
          {
            type: 'evidence-upload',
            payload: {
              aidId,
              ...upload,
            },
          },
          { online: isConnected },
        ),
      getActionsForAid: (aidId: string) =>
        syncState.items.filter((item) => {
          const payload = item.payload as { aidId?: string };
          return payload.aidId === aidId;
        }),
    };
  }, [flushNow, isConnected, lastCompletedAction, syncState]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export const useSync = () => useContext(SyncContext);
