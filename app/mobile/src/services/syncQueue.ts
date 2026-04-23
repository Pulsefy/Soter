import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { AidDetails, fetchAidDetails } from './aidApi';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

const SYNC_QUEUE_STORAGE_KEY = '@soter/sync-queue';
const DEFAULT_MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

export type SyncActionType = 'status-refresh' | 'claim-confirmation' | 'evidence-upload';
export type SyncActionState = 'pending' | 'retrying' | 'failed';

export interface StatusRefreshPayload {
  aidId: string;
}

export interface ClaimConfirmationPayload {
  aidId: string;
  claimId: string;
}

export interface EvidenceUploadPayload {
  aidId: string;
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
}

export type SyncActionPayload =
  | StatusRefreshPayload
  | ClaimConfirmationPayload
  | EvidenceUploadPayload;

export interface QueuedSyncAction<TPayload = SyncActionPayload> {
  id: string;
  type: SyncActionType;
  payload: TPayload;
  state: SyncActionState;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface SyncQueueState {
  items: QueuedSyncAction[];
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface SyncActionSuccessEvent {
  action: QueuedSyncAction;
  completedAt: string;
  result: unknown;
}

type QueueSubscriber = (state: SyncQueueState) => void;
type SuccessSubscriber = (event: SyncActionSuccessEvent) => void;

type SyncActionRequest =
  | { type: 'status-refresh'; payload: StatusRefreshPayload; maxRetries?: number }
  | { type: 'claim-confirmation'; payload: ClaimConfirmationPayload; maxRetries?: number }
  | { type: 'evidence-upload'; payload: EvidenceUploadPayload; maxRetries?: number };

type SyncExecutionResultMap = {
  'status-refresh': AidDetails;
  'claim-confirmation': unknown;
  'evidence-upload': unknown;
};

type SyncDispatchResult<T extends SyncActionType = SyncActionType> =
  | { status: 'completed'; result: SyncExecutionResultMap[T] }
  | { status: 'queued'; action: QueuedSyncAction };

let queueState: SyncQueueState = {
  items: [],
  isSyncing: false,
  lastSyncAt: null,
  lastSyncError: null,
};
let hydrated = false;
let syncingPromise: Promise<void> | null = null;

const queueSubscribers = new Set<QueueSubscriber>();
const successSubscribers = new Set<SuccessSubscriber>();

const cloneState = (): SyncQueueState => ({
  ...queueState,
  items: [...queueState.items],
});

const emitQueueState = () => {
  const snapshot = cloneState();
  queueSubscribers.forEach((listener) => listener(snapshot));
};

const setQueueState = (nextState: Partial<SyncQueueState>) => {
  queueState = {
    ...queueState,
    ...nextState,
  };
  emitQueueState();
};

const persistQueue = async () => {
  await AsyncStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(queueState.items));
};

const makeActionId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const backoffDelayMs = (retryCount: number) =>
  Math.min(BASE_RETRY_DELAY_MS * 2 ** retryCount, MAX_RETRY_DELAY_MS);

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected sync failure';
};

const isRetryableError = (error: unknown) => {
  const message = toErrorMessage(error).toLowerCase();

  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('request failed') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('500') ||
    message.includes('429')
  );
};

const hydrateQueue = async () => {
  if (hydrated) {
    return cloneState();
  }

  const raw = await AsyncStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
  const parsed = raw ? (JSON.parse(raw) as QueuedSyncAction[]) : [];

  queueState = {
    ...queueState,
    items: Array.isArray(parsed) ? parsed : [],
  };
  hydrated = true;
  emitQueueState();
  return cloneState();
};

const replaceQueueItems = async (items: QueuedSyncAction[]) => {
  queueState = {
    ...queueState,
    items,
  };
  await persistQueue();
  emitQueueState();
};

const enqueue = async (request: SyncActionRequest) => {
  await hydrateQueue();

  const now = new Date().toISOString();
  const action: QueuedSyncAction = {
    id: makeActionId(),
    type: request.type,
    payload: request.payload,
    state: 'pending',
    retryCount: 0,
    maxRetries: request.maxRetries ?? DEFAULT_MAX_RETRIES,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };

  await replaceQueueItems([...queueState.items, action]);
  return action;
};

const runAction = async (action: QueuedSyncAction) => {
  switch (action.type) {
    case 'status-refresh':
      return fetchAidDetails((action.payload as StatusRefreshPayload).aidId);
    case 'claim-confirmation': {
      const { claimId } = action.payload as ClaimConfirmationPayload;
      const response = await fetch(`${API_URL}/claims/${claimId}/verify`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    }
    case 'evidence-upload': {
      const { url, method = 'POST', headers, body } = action.payload as EvidenceUploadPayload;
      const response = await fetch(url, {
        method,
        headers,
        body,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    }
    default:
      throw new Error(`Unsupported sync action type: ${String(action.type)}`);
  }
};

export const subscribeToSyncQueue = (listener: QueueSubscriber) => {
  queueSubscribers.add(listener);
  listener(cloneState());

  return () => {
    queueSubscribers.delete(listener);
  };
};

export const subscribeToSyncSuccess = (listener: SuccessSubscriber) => {
  successSubscribers.add(listener);

  return () => {
    successSubscribers.delete(listener);
  };
};

export const getSyncQueueState = async () => {
  await hydrateQueue();
  return cloneState();
};

export const dispatchNetworkAction = async <T extends SyncActionType>(
  request: Extract<SyncActionRequest, { type: T }>,
  options?: { online?: boolean },
): Promise<SyncDispatchResult<T>> => {
  await hydrateQueue();

  if (!options?.online) {
    const action = await enqueue(request);
    return { status: 'queued', action };
  }

  const now = new Date().toISOString();
  const previewAction: QueuedSyncAction = {
    id: makeActionId(),
    type: request.type,
    payload: request.payload,
    state: 'pending',
    retryCount: 0,
    maxRetries: request.maxRetries ?? DEFAULT_MAX_RETRIES,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };

  try {
    const result = (await runAction(previewAction)) as SyncExecutionResultMap[T];
    const completedAt = new Date().toISOString();
    successSubscribers.forEach((listener) =>
      listener({ action: previewAction, completedAt, result }),
    );
    setQueueState({
      lastSyncAt: completedAt,
      lastSyncError: null,
    });
    return { status: 'completed', result };
  } catch (error) {
    if (!isRetryableError(error)) {
      throw error;
    }

    const action = await enqueue(request);
    setQueueState({
      lastSyncError: toErrorMessage(error),
    });
    return { status: 'queued', action };
  }
};

export const flushPendingNetworkActions = async (options?: { online?: boolean }) => {
  await hydrateQueue();

  if (options?.online === false || syncingPromise) {
    return syncingPromise ?? Promise.resolve();
  }

  syncingPromise = (async () => {
    setQueueState({
      isSyncing: true,
      lastSyncError: null,
    });

    let items = [...queueState.items];
    const now = Date.now();

    for (const action of items) {
      if (new Date(action.nextRetryAt).getTime() > now) {
        continue;
      }

      try {
        const result = await runAction(action);
        items = items.filter((item) => item.id !== action.id);
        queueState = {
          ...queueState,
          items,
          lastSyncAt: new Date().toISOString(),
          lastSyncError: null,
        };
        await persistQueue();
        emitQueueState();
        successSubscribers.forEach((listener) =>
          listener({
            action,
            completedAt: queueState.lastSyncAt as string,
            result,
          }),
        );
      } catch (error) {
        const retryCount = action.retryCount + 1;
        const nextState: SyncActionState =
          retryCount >= action.maxRetries || !isRetryableError(error) ? 'failed' : 'retrying';

        items = items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                state: nextState,
                retryCount,
                nextRetryAt: new Date(
                  Date.now() + backoffDelayMs(retryCount),
                ).toISOString(),
                updatedAt: new Date().toISOString(),
                lastError: toErrorMessage(error),
              }
            : item,
        );

        queueState = {
          ...queueState,
          items,
          lastSyncError: toErrorMessage(error),
        };
        await persistQueue();
        emitQueueState();
      }
    }

    setQueueState({
      isSyncing: false,
      lastSyncAt: queueState.lastSyncAt ?? new Date().toISOString(),
    });
  })().finally(() => {
    syncingPromise = null;
  });

  return syncingPromise;
};

export const clearSyncQueue = async () => {
  await hydrateQueue();
  await replaceQueueItems([]);
  setQueueState({
    lastSyncError: null,
  });
};
