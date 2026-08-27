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
export type SyncActionState = 'pending' | 'retrying' | 'failed' | 'submitted' | 'conflict';

export type DeferralReason = 'low-battery' | 'metered-connection' | 'large-upload' | 'none';

export interface StatusRefreshPayload {
  aidId: string;
  urgent?: boolean;
}

export interface ClaimConfirmationPayload {
  aidId: string;
  claimId: string;
  urgent?: boolean;
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
  urgent?: boolean;
  estimatedSize?: number;
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
  urgent?: boolean;
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
  deferralReason?: DeferralReason;
  deferralLog?: string[];
}

export interface SyncQueueState {
  items: QueuedSyncAction[];
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  deferralStatus?: {
    deferred: boolean;
    reason: DeferralReason;
    explanation: string;
  };
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

export const isConflictError = (error: unknown): boolean => {
  const message = toErrorMessage(error).toLowerCase();
  const conflictPatterns = [
    '409',
    'conflict',
    'already claimed',
    'already submitted',
    'already disbursed',
    'already verified',
    'already processed',
    'duplicate',
    'version mismatch',
    'idempotency conflict',
    'state conflict',
    'mismatch',
  ];
  return conflictPatterns.some((pattern) => message.includes(pattern));
};

export const mapConflictErrorMessage = (rawError: string | null | undefined): string => {
  if (!rawError) {
    return 'Conflict detected with server records.';
  }
  const lower = rawError.toLowerCase();

  if (lower.includes('already claimed') || lower.includes('already submitted')) {
    return 'Conflict: This claim has already been submitted and processed on the server.';
  }
  if (lower.includes('already disbursed')) {
    return 'Conflict: This aid package has already been disbursed to the recipient.';
  }
  if (lower.includes('duplicate') || lower.includes('idempotency')) {
    return 'Conflict: A submission with an identical idempotency key already exists on the server.';
  }
  if (lower.includes('version') || lower.includes('mismatch')) {
    return 'Conflict: Server record version mismatch. The record was updated by another operator.';
  }
  if (lower.includes('already verified')) {
    return 'Conflict: This claim was already verified in a prior transaction.';
  }
  if (lower.includes('409') || lower.includes('conflict')) {
    return 'Conflict: The submission conflicts with existing server records.';
  }

  return `Conflict: ${rawError}`;
};

const isRetryableError = (error: unknown) => {
  if (isConflictError(error)) {
    return false;
  }

  const message = toErrorMessage(error).toLowerCase();

  const permanentFailurePatterns = [
    '400',
    '401',
    '403',
    '404',
    'bad request',
    'unauthorized',
    'forbidden',
    'not found',
    'validation',
  ];

  if (permanentFailurePatterns.some((pattern) => message.includes(pattern))) {
    return false;
  }

  const retryableFailurePatterns = [
    'network',
    'timeout',
    'failed to fetch',
    'request failed',
    '429',
    '500',
    '502',
    '503',
  ];

  return retryableFailurePatterns.some((pattern) => message.includes(pattern));
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

const logDeferral = (action: QueuedSyncAction, reason: DeferralReason, details: string) => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] Deferred: ${reason} - ${details}`;
  
  const updatedLog = action.deferralLog ? [...action.deferralLog, logEntry] : [logEntry];
  
  queueState = {
    ...queueState,
    items: queueState.items.map(item =>
      item.id === action.id
        ? { ...item, deferralReason: reason, deferralLog: updatedLog }
        : item
    ),
  };
  
  void persistQueue();
  emitQueueState();
  
  return logEntry;
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
    if (isConflictError(error)) {
      const now = new Date().toISOString();
      const conflictMessage = mapConflictErrorMessage(toErrorMessage(error));
      const action: QueuedSyncAction = {
        id: makeActionId(),
        type: request.type,
        payload: request.payload,
        state: 'conflict',
        retryCount: 1,
        maxRetries: request.maxRetries ?? DEFAULT_MAX_RETRIES,
        nextRetryAt: now,
        createdAt: now,
        updatedAt: now,
        lastError: toErrorMessage(error),
      };
      await replaceQueueItems([...queueState.items, action]);
      setQueueState({
        lastSyncError: conflictMessage,
      });
      return { status: 'queued', action };
    }

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

export const flushPendingNetworkActions = async (options?: { 
  online?: boolean; 
  saverMode?: boolean;
  forceSync?: boolean;
  batteryLevel?: number;
  isCharging?: boolean;
  isMetered?: boolean;
  meteredOptIn?: boolean;
}) => {
  await hydrateQueue();

  if (options?.online === false || syncingPromise) {
    return syncingPromise ?? Promise.resolve();
  }

  const isSaverMode = options?.saverMode === true;
  const forceSync = options?.forceSync === true;
  const batteryLevel = options?.batteryLevel ?? -1;
  const isCharging = options?.isCharging ?? false;
  const isMetered = options?.isMetered ?? false;
  const meteredOptIn = options?.meteredOptIn ?? false;

  syncingPromise = (async () => {
    setQueueState({
      isSyncing: true,
      lastSyncError: null,
    });

    let items = [...queueState.items];
    const now = Date.now();
    let actionsProcessed = 0;
    let deferredCount = 0;
    const deferralLog: string[] = [];

    for (const action of items) {
      if (new Date(action.nextRetryAt).getTime() > now) {
        continue;
      }

      // Check if action should be deferred
      const payload = action.payload as { urgent?: boolean; estimatedSize?: number };
      const isUrgent = payload.urgent === true;
      const estimatedSize = payload.estimatedSize || 0;
      
      // Calculate battery threshold
      const batteryThreshold = 0.2; // Default 20%
      const isLowBattery = !isCharging && batteryLevel >= 0 && batteryLevel < batteryThreshold;
      
      // Calculate large upload threshold
      const largeUploadThreshold = 5 * 1024 * 1024; // Default 5MB
      const isLargeUpload = action.type === 'evidence-upload' && estimatedSize > largeUploadThreshold;
      
      let shouldDefer = false;
      let deferralReason: DeferralReason = 'none';

      // Urgent items bypass most deferrals except critical battery
      if (!isUrgent || (isUrgent && isLowBattery)) {
        if (!forceSync) {
          // Low battery deferral
          if (isLowBattery) {
            shouldDefer = true;
            deferralReason = 'low-battery';
            const logMsg = logDeferral(action, deferralReason, `Battery at ${Math.round(batteryLevel * 100)}%, threshold ${Math.round(batteryThreshold * 100)}%`);
            deferralLog.push(logMsg);
          }
          // Large upload on metered connection deferral
          else if (isMetered && !meteredOptIn && isLargeUpload) {
            shouldDefer = true;
            deferralReason = 'large-upload';
            const logMsg = logDeferral(action, deferralReason, `Upload size ${Math.round(estimatedSize / 1024 / 1024)}MB on metered connection`);
            deferralLog.push(logMsg);
          }
          // Metered connection deferral
          else if (isMetered && !meteredOptIn) {
            shouldDefer = true;
            deferralReason = 'metered-connection';
            const logMsg = logDeferral(action, deferralReason, 'Metered connection without user opt-in');
            deferralLog.push(logMsg);
          }
        }
      }

      if (shouldDefer) {
        deferredCount++;
        // Update action with deferral info
        items = items.map(item =>
          item.id === action.id
            ? { ...item, deferralReason, updatedAt: new Date().toISOString() }
            : item
        );
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
        const isConflict = isConflictError(error);
        const retryCount = action.retryCount + 1;
        const nextState: SyncActionState = isConflict
          ? 'conflict'
          : retryCount >= action.maxRetries || !isRetryableError(error)
          ? 'failed'
          : 'retrying';

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
          lastSyncError: isConflict
            ? mapConflictErrorMessage(toErrorMessage(error))
            : toErrorMessage(error),
        };
        await persistQueue();
        emitQueueState();
      }
    }

    setQueueState({
      isSyncing: false,
      lastSyncAt: queueState.lastSyncAt ?? new Date().toISOString(),
      deferralStatus: deferredCount > 0 ? {
        deferred: true,
        reason: items.find(i => i.deferralReason)?.deferralReason || 'none',
        explanation: `${deferredCount} actions deferred due to battery/network constraints`,
      } : undefined,
    });
  })().finally(() => {
    syncingPromise = null;
  });

  return syncingPromise;
};

export const requeueAction = async (actionId: string) => {
  await hydrateQueue();
  const now = new Date().toISOString();
  const items = queueState.items.map((item) =>
    item.id === actionId
      ? { ...item, state: 'pending' as SyncActionState, retryCount: 0, nextRetryAt: now, lastError: null, updatedAt: now }
      : item,
  );
  await replaceQueueItems(items);
};

export const retryFailedAction = requeueAction;

export const discardAction = async (actionId: string) => {
  await hydrateQueue();
  const items = queueState.items.filter((item) => item.id !== actionId);
  await replaceQueueItems(items);
};

export const clearSyncQueue = async () => {
  await hydrateQueue();
  await replaceQueueItems([]);
  setQueueState({
    lastSyncError: null,
  });
};
