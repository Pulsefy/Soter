import AsyncStorage from '@react-native-async-storage/async-storage';
import { AidDetails, fetchAidDetails, submitClaim } from './aidApi';

import { config } from '../config';

const API_URL = config.apiUrl;

const SYNC_QUEUE_STORAGE_KEY = '@soter/sync-queue';
const DEFAULT_MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

/** In saver mode, backoff delays are multiplied by this factor to reduce
 *  how often the queue retries over the network. */
const SAVER_BACKOFF_MULTIPLIER = 3;

/** In saver mode, limit concurrent flush actions to this many per cycle. */
const SAVER_MAX_ACTIONS_PER_FLUSH = 2;

export type SyncActionType = 'status-refresh' | 'claim-confirmation' | 'evidence-upload' | 'claim-submission';
export type SyncActionState = 'pending' | 'retrying' | 'failed' | 'submitted';

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
  sessionId?: string;
  uploadedChunks?: number[];
  totalChunks?: number;
  progress?: number;
}

const getSubtleCrypto = () => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle;
  }
  try {
    return require('crypto').webcrypto.subtle;
  } catch {
    return null;
  }
};

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Uint8Array(256);
for (let i = 0; i < chars.length; i++) {
  lookup[chars.charCodeAt(i)] = i;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const commaIdx = base64.indexOf(',');
  let cleanBase64 = commaIdx !== -1 ? base64.substring(commaIdx + 1) : base64;
  cleanBase64 = cleanBase64.replace(/\s/g, '');

  let bufferLength = cleanBase64.length * 0.75;
  const len = cleanBase64.length;
  let p = 0;

  if (cleanBase64[cleanBase64.length - 1] === '=') {
    bufferLength--;
    if (cleanBase64[cleanBase64.length - 2] === '=') {
      bufferLength--;
    }
  }

  const bytes = new Uint8Array(bufferLength);

  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[cleanBase64.charCodeAt(i)];
    const encoded2 = lookup[cleanBase64.charCodeAt(i + 1)];
    const encoded3 = lookup[cleanBase64.charCodeAt(i + 2)];
    const encoded4 = lookup[cleanBase64.charCodeAt(i + 3)];

    const bytesVal = (encoded1 << 18) | (encoded2 << 12) | (encoded3 << 6) | encoded4;

    bytes[p++] = (bytesVal >> 16) & 255;
    if (p < bufferLength) {
      bytes[p++] = (bytesVal >> 8) & 255;
      if (p < bufferLength) {
        bytes[p++] = bytesVal & 255;
      }
    }
  }
  return bytes;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = getSubtleCrypto();
  if (!subtle) {
    throw new Error('WebCrypto subtle is not available');
  }
  const hashBuffer = await subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ClaimSubmissionPayload {
  aidId: string;
  claimId: string;
  idempotencyKey: string;
}

export type SyncActionPayload =
  | StatusRefreshPayload
  | ClaimConfirmationPayload
  | EvidenceUploadPayload
  | ClaimSubmissionPayload;

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
  | { type: 'evidence-upload'; payload: EvidenceUploadPayload; maxRetries?: number }
  | { type: 'claim-submission'; payload: ClaimSubmissionPayload; maxRetries?: number };

type SyncExecutionResultMap = {
  'status-refresh': AidDetails;
  'claim-confirmation': unknown;
  'evidence-upload': unknown;
  'claim-submission': unknown;
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

  // Idempotency: if a claim-submission with the same key is already queued
  // (pending or retrying), return the existing action instead of duplicating.
  if (request.type === 'claim-submission') {
    const key = (request.payload as ClaimSubmissionPayload).idempotencyKey;
    const existing = queueState.items.find(
      (item) =>
        item.type === 'claim-submission' &&
        (item.payload as ClaimSubmissionPayload).idempotencyKey === key &&
        item.state !== 'failed' &&
        item.state !== 'submitted',
    );
    if (existing) return existing;
  }

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
      const payload = action.payload as EvidenceUploadPayload;
      if (!payload.body) {
        throw new Error('No evidence upload payload body found');
      }

      let requestData: {
        filename: string;
        contentType: string;
        imageBase64: string;
      };
      try {
        requestData = JSON.parse(payload.body);
      } catch (err) {
        throw new Error('Failed to parse upload request body');
      }

      const fileBytes = base64ToUint8Array(requestData.imageBase64);
      const chunkSize = 512 * 1024; // 512 KB chunks

      if (!payload.sessionId) {
        const createSessionRes = await fetch(`${API_URL}/evidence/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: requestData.filename,
            mimeType: requestData.contentType,
            totalSize: fileBytes.length,
            chunkSize,
          }),
        });

        if (!createSessionRes.ok) {
          let errorMsg = `HTTP error ${createSessionRes.status}`;
          try {
            const errData = await createSessionRes.json();
            if (errData?.message) errorMsg = errData.message;
          } catch {}
          throw new Error(`Failed to create upload session: ${errorMsg}`);
        }

        const session = await createSessionRes.json();
        payload.sessionId = session.id;
        payload.totalChunks = session.totalChunks;
        payload.uploadedChunks = [];
        payload.progress = 0;
        await persistQueue();
        emitQueueState();
      } else {
        const statusRes = await fetch(`${API_URL}/evidence/upload-sessions/${payload.sessionId}/status`);
        if (statusRes.status === 404) {
          payload.sessionId = undefined;
          payload.uploadedChunks = undefined;
          payload.totalChunks = undefined;
          payload.progress = 0;
          await persistQueue();
          emitQueueState();
          return runAction(action);
        }
        if (!statusRes.ok) {
          throw new Error(`Failed to query session status: ${statusRes.status}`);
        }
        const statusData = await statusRes.json();
        payload.uploadedChunks = statusData.receivedChunks || [];
        payload.totalChunks = statusData.totalChunks;
        payload.progress = payload.totalChunks ? payload.uploadedChunks.length / payload.totalChunks : 0;
        await persistQueue();
        emitQueueState();
      }

      const totalChunks = payload.totalChunks || 0;
      const uploadedChunks = payload.uploadedChunks || [];

      for (let index = 0; index < totalChunks; index++) {
        if (uploadedChunks.includes(index)) {
          continue;
        }

        const start = index * chunkSize;
        const end = Math.min(start + chunkSize, fileBytes.length);
        const chunkBytes = fileBytes.subarray(start, end);

        const checksum = await sha256Hex(chunkBytes);
        const chunkBlob = new Blob([chunkBytes], { type: 'application/octet-stream' });

        const formData = new FormData();
        formData.append('chunk', chunkBlob, requestData.filename);
        formData.append('index', index.toString());
        formData.append('checksum', checksum);

        const uploadChunkRes = await fetch(`${API_URL}/evidence/upload-sessions/${payload.sessionId}/chunks`, {
          method: 'POST',
          body: formData,
        });

        if (!uploadChunkRes.ok) {
          let errorMsg = `HTTP error ${uploadChunkRes.status}`;
          try {
            const errData = await uploadChunkRes.json();
            if (errData?.message) errorMsg = errData.message;
          } catch {}
          throw new Error(`Chunk ${index} upload failed: ${errorMsg}`);
        }

        uploadedChunks.push(index);
        payload.uploadedChunks = uploadedChunks;
        payload.progress = uploadedChunks.length / totalChunks;
        await persistQueue();
        emitQueueState();
      }

      const finalizeRes = await fetch(`${API_URL}/evidence/upload-sessions/${payload.sessionId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!finalizeRes.ok) {
        let errorMsg = `HTTP error ${finalizeRes.status}`;
        try {
          const errData = await finalizeRes.json();
          if (errData?.message) errorMsg = errData.message;
        } catch {}
        throw new Error(`Failed to finalize upload: ${errorMsg}`);
      }

      return finalizeRes.json();
    }
    case 'claim-submission': {
      const { claimId, idempotencyKey } = action.payload as ClaimSubmissionPayload;
      return submitClaim(claimId, idempotencyKey);
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

export const flushPendingNetworkActions = async (options?: { online?: boolean; saverMode?: boolean }) => {
  await hydrateQueue();

  if (options?.online === false || syncingPromise) {
    return syncingPromise ?? Promise.resolve();
  }

  const isSaverMode = options?.saverMode === true;

  syncingPromise = (async () => {
    setQueueState({
      isSyncing: true,
      lastSyncError: null,
    });

    let items = [...queueState.items];
    const now = Date.now();
    let actionsProcessed = 0;

    for (const action of items) {
      if (new Date(action.nextRetryAt).getTime() > now) {
        continue;
      }

      // In saver mode, limit the number of actions processed per flush
      // to reduce data consumption
      if (isSaverMode && actionsProcessed >= SAVER_MAX_ACTIONS_PER_FLUSH) {
        break;
      }
      actionsProcessed++;

      try {
        const result = await runAction(action);
        if (action.type === 'claim-submission') {
          // Keep the item in the queue as 'submitted' for status display
          items = items.map((item) =>
            item.id === action.id
              ? { ...item, state: 'submitted' as SyncActionState, updatedAt: new Date().toISOString() }
              : item,
          );
        } else {
          items = items.filter((item) => item.id !== action.id);
        }
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

        // In saver mode, use a longer backoff to reduce network usage
        const backoffMultiplier = isSaverMode ? SAVER_BACKOFF_MULTIPLIER : 1;

        items = items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                state: nextState,
                retryCount,
                nextRetryAt: new Date(
                  Date.now() + backoffDelayMs(retryCount) * backoffMultiplier,
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

export const retryFailedAction = async (actionId: string) => {
  await hydrateQueue();
  const now = new Date().toISOString();
  const items = queueState.items.map((item) =>
    item.id === actionId && item.state === 'failed'
      ? { ...item, state: 'pending' as SyncActionState, retryCount: 0, nextRetryAt: now, lastError: null, updatedAt: now }
      : item,
  );
  await replaceQueueItems(items);
};

export const clearSyncQueue = async () => {
  await hydrateQueue();
  await replaceQueueItems([]);
  setQueueState({
    lastSyncError: null,
  });
};
