/**
 * Tests for:
 *  - syncQueue claim-submission idempotency dedup
 *  - syncQueue retryFailedAction
 *  - SubmissionStatusBadge rendering
 *  - SubmissionQueueScreen discard confirmation dialogs
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SubmissionStatusBadge } from '../components/SubmissionStatusBadge';
import { SubmissionQueueScreen } from '../screens/SubmissionQueueScreen';

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: ({ name, testID }: { name: string; testID?: string }) => {
    const { Text } = require('react-native');
    return <Text testID={testID ?? `icon-${name}`}>{name}</Text>;
  },
}));

// i18n-js and expo-localization are not installed in the test environment.
// Stub useTranslation and LanguageContext at the hook level so SubmissionQueueScreen
// can be imported and rendered without any missing-module errors.
jest.mock('../i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'submissionQueue.title': 'Submission Queue',
        'submissionQueue.retries': 'Retries',
        'submissionQueue.updated': 'Updated',
        'submissionQueue.inspectDetails': 'Inspect Details',
        'submissionQueue.requeue': 'Requeue',
        'submissionQueue.discard': 'Discard',
        'submissionQueue.syncDeferred': 'Sync Deferred',
        'submissionQueue.empty': 'No queued submissions',
        'submissionQueue.inspectItem': 'Inspect Submission Item',
        'submissionQueue.actionDetails': 'Action Details',
        'submissionQueue.actionId': 'Action ID:',
        'submissionQueue.correlationId': 'Correlation ID:',
        'submissionQueue.type': 'Type:',
        'submissionQueue.created': 'Created:',
        'submissionQueue.lastUpdated': 'Last Updated:',
        'submissionQueue.rawBackendResponse': 'Raw Backend Response:',
        'submissionQueue.payloadParameters': 'Payload Parameters',
        'submissionQueue.deferralInformation': 'Deferral Information',
        'submissionQueue.deferralLog': 'Deferral Log:',
        'submissionQueue.retriesLabel': 'Retries:',
        'submissionQueue.discardConfirmTitle': 'Discard Queued Item?',
        'submissionQueue.discardConfirmMessage': 'This will permanently discard 1 {type} item. Any unsynced field work it contains will be lost.',
        'submissionQueue.discardConfirmOk': 'Discard',
        'submissionQueue.discardConfirmCancel': 'Cancel',
        'submissionQueue.clearAllButton': 'Clear All',
        'submissionQueue.clearAllConfirmTitle': 'Clear All Queued Items?',
        'submissionQueue.clearAllConfirmMessage': 'This will permanently discard all {count} queued item(s) ({types}). Any unsynced field work they contain will be lost.',
        'submissionQueue.clearAllConfirmOk': 'Clear All',
        'submissionQueue.clearAllConfirmCancel': 'Cancel',
        'common.close': 'Close',
      };
      return map[key] ?? key;
    },
    locale: 'en',
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: any) => <View style={style}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../contexts/SyncDeferralContext', () => ({
  useSyncDeferral: () => ({
    batteryLevel: 1,
    isCharging: true,
    isMetered: false,
    meteredOptIn: false,
    setMeteredOptIn: jest.fn(),
    forceSync: jest.fn(),
    deferralStatus: null,
  }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#FFFFFF',
      surface: '#F9FAFB',
      border: '#E5E7EB',
      textPrimary: '#111827',
      textSecondary: '#6B7280',
      primary: '#2563EB',
      error: '#DC2626',
      warningBg: '#FEF3C7',
      warning: '#92400E',
      infoBg: '#DBEAFE',
      info: '#1E40AF',
      successBg: '#D1FAE5',
      success: '#065F46',
      errorBg: '#FEE2E2',
    },
  }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

const QUEUE_KEY = '@soter/sync-queue';

const seedStorage = async (items: object[]) => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
};

const mockFetchStatus = (status: number) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue({ ok: true }),
  }) as unknown as typeof fetch;
};

const makeQueuedClaimSubmission = (overrides: Partial<object> = {}) => ({
  id: 'queued-claim-1',
  type: 'claim-submission',
  payload: {
    aidId: 'aid-1',
    claimId: 'claim-1',
    idempotencyKey: 'idem-queued-1',
  },
  state: 'pending',
  retryCount: 0,
  maxRetries: 5,
  nextRetryAt: new Date(Date.now() - 1000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastError: null,
  ...overrides,
});

type SyncQueueModule = typeof import('../services/syncQueue');

/** Load a fresh copy of syncQueue with a clean in-memory state. */
const loadFreshQueue = (): SyncQueueModule => {
  let mod!: SyncQueueModule;
  jest.isolateModules(() => {
    mod = require('../services/syncQueue') as SyncQueueModule;
  });
  return mod;
};

// ── syncQueue idempotency ─────────────────────────────────────────────────────

describe('syncQueue – claim-submission idempotency', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('enqueues a new claim-submission and returns it', async () => {
    const { dispatchNetworkAction, getSyncQueueState } = loadFreshQueue();
    const result = await dispatchNetworkAction(
      { type: 'claim-submission', payload: { aidId: 'aid-1', claimId: 'claim-1', idempotencyKey: 'idem-abc' } },
      { online: false },
    );

    expect(result.status).toBe('queued');
    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].type).toBe('claim-submission');
  });

  it('returns the existing item when the same idempotency key is enqueued twice', async () => {
    const { dispatchNetworkAction, getSyncQueueState } = loadFreshQueue();
    const payload = { aidId: 'aid-1', claimId: 'claim-1', idempotencyKey: 'idem-dup' };

    const first = await dispatchNetworkAction({ type: 'claim-submission', payload }, { online: false });
    const second = await dispatchNetworkAction({ type: 'claim-submission', payload }, { online: false });

    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');
    if (first.status === 'queued' && second.status === 'queued') {
      expect(first.action.id).toBe(second.action.id);
    }
    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(1);
  });

  it('allows re-enqueue when the existing item is failed', async () => {
    const payload = { aidId: 'aid-1', claimId: 'claim-1', idempotencyKey: 'idem-fail' };

    // Seed storage with a failed item
    const failedItem = {
      id: 'existing-id',
      type: 'claim-submission',
      payload,
      state: 'failed',
      retryCount: 5,
      maxRetries: 5,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: 'network error',
    };
    await seedStorage([failedItem]);

    // Fresh module hydrates from storage with the failed item
    const { dispatchNetworkAction, getSyncQueueState } = loadFreshQueue();

    const result = await dispatchNetworkAction({ type: 'claim-submission', payload }, { online: false });
    expect(result.status).toBe('queued');

    const state = await getSyncQueueState();
    const pending = state.items.find((i) => i.state === 'pending');
    expect(pending).toBeDefined();
  });
});

describe('syncQueue retry classification', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('queues an online claim submission after a retryable server failure', async () => {
    mockFetchStatus(500);

    const { dispatchNetworkAction, getSyncQueueState } = loadFreshQueue();

    const result = await dispatchNetworkAction(
      {
        type: 'claim-submission',
        payload: {
          aidId: 'aid-1',
          claimId: 'claim-1',
          idempotencyKey: 'idem-retryable-500',
        },
      },
      { online: true },
    );

    expect(result.status).toBe('queued');

    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].state).toBe('pending');
    expect(state.lastSyncError).toContain('500');
  });

  it('does not queue an online claim submission after a non-retryable client failure', async () => {
    mockFetchStatus(400);

    const { dispatchNetworkAction, getSyncQueueState } = loadFreshQueue();

    await expect(
      dispatchNetworkAction(
        {
          type: 'claim-submission',
          payload: {
            aidId: 'aid-1',
            claimId: 'claim-1',
            idempotencyKey: 'idem-nonretryable-400',
          },
        },
        { online: true },
      ),
    ).rejects.toThrow('400');

    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(0);
  });

  it('keeps a queued item retrying after a retryable flush failure', async () => {
    mockFetchStatus(503);

    await seedStorage([makeQueuedClaimSubmission()]);

    const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();

    await flushPendingNetworkActions({ online: true });

    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].state).toBe('retrying');
    expect(state.items[0].retryCount).toBe(1);
    expect(state.items[0].lastError).toContain('503');
    expect(new Date(state.items[0].nextRetryAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('marks a queued item failed after a non-retryable flush failure', async () => {
    mockFetchStatus(401);

    await seedStorage([makeQueuedClaimSubmission()]);

    const { flushPendingNetworkActions, getSyncQueueState } = loadFreshQueue();

    await flushPendingNetworkActions({ online: true });

    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].state).toBe('failed');
    expect(state.items[0].retryCount).toBe(1);
    expect(state.items[0].lastError).toContain('401');
  });
});

// ── syncQueue retryFailedAction ───────────────────────────────────────────────

describe('syncQueue – retryFailedAction', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('resets a failed item back to pending', async () => {
    const failedItem = {
      id: 'test-id-1',
      type: 'claim-submission',
      payload: { aidId: 'aid-2', claimId: 'claim-2', idempotencyKey: 'idem-retry' },
      state: 'failed',
      retryCount: 3,
      maxRetries: 5,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: 'network error',
    };
    await seedStorage([failedItem]);

    const { getSyncQueueState, retryFailedAction } = loadFreshQueue();

    const stateBefore = await getSyncQueueState();
    expect(stateBefore.items[0].state).toBe('failed');

    await retryFailedAction(stateBefore.items[0].id);

    const stateAfter = await getSyncQueueState();
    expect(stateAfter.items[0].state).toBe('pending');
    expect(stateAfter.items[0].retryCount).toBe(0);
    expect(stateAfter.items[0].lastError).toBeNull();
  });

  it('resets a retrying item back to pending', async () => {
    const retryingItem = {
      id: 'test-id-3',
      type: 'claim-submission',
      payload: { aidId: 'aid-4', claimId: 'claim-4', idempotencyKey: 'idem-retry-retrying' },
      state: 'retrying',
      retryCount: 2,
      maxRetries: 5,
      nextRetryAt: new Date(Date.now() + 100000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: 'network timeout',
    };
    await seedStorage([retryingItem]);

    const { getSyncQueueState, retryFailedAction } = loadFreshQueue();

    const stateBefore = await getSyncQueueState();
    expect(stateBefore.items[0].state).toBe('retrying');

    await retryFailedAction(stateBefore.items[0].id);

    const stateAfter = await getSyncQueueState();
    expect(stateAfter.items[0].state).toBe('pending');
    expect(stateAfter.items[0].retryCount).toBe(0);
    expect(stateAfter.items[0].lastError).toBeNull();
  });

  it('does not change a non-failed/non-retrying item', async () => {
    const pendingItem = {
      id: 'test-id-2',
      type: 'claim-submission',
      payload: { aidId: 'aid-3', claimId: 'claim-3', idempotencyKey: 'idem-noop' },
      state: 'pending',
      retryCount: 0,
      maxRetries: 5,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: null,
    };
    await seedStorage([pendingItem]);

    const { getSyncQueueState, retryFailedAction } = loadFreshQueue();

    const state = await getSyncQueueState();
    await retryFailedAction(state.items[0].id);

    const stateAfter = await getSyncQueueState();
    expect(stateAfter.items[0].state).toBe('pending');
  });

  it('identifies 409 conflict errors and sets action state to conflict', async () => {
    const { dispatchNetworkAction, getSyncQueueState, isConflictError, mapConflictErrorMessage } = loadFreshQueue();
    global.fetch = jest.fn().mockRejectedValue(new Error('HTTP error 409: Conflict - already claimed')) as unknown as typeof fetch;

    const result = await dispatchNetworkAction(
      { type: 'claim-submission', payload: { aidId: 'aid-1', claimId: 'claim-1', idempotencyKey: 'idem-409' } },
      { online: true },
    );

    expect(result.status).toBe('queued');
    const state = await getSyncQueueState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].state).toBe('conflict');
    expect(isConflictError(state.items[0].lastError)).toBe(true);

    const clearMsg = mapConflictErrorMessage(state.items[0].lastError);
    expect(clearMsg).toContain('Conflict: This claim has already been submitted and processed on the server.');
  });

  it('allows discarding an item from the queue', async () => {
    const itemToDiscard = {
      id: 'discard-1',
      type: 'claim-submission',
      payload: { aidId: 'aid-disc', claimId: 'claim-disc', idempotencyKey: 'idem-disc' },
      state: 'conflict',
      retryCount: 1,
      maxRetries: 5,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: 'HTTP 409 Conflict',
    };
    await seedStorage([itemToDiscard]);

    const { getSyncQueueState, discardAction } = loadFreshQueue();
    await discardAction('discard-1');

    const stateAfter = await getSyncQueueState();
    expect(stateAfter.items).toHaveLength(0);
  });

  it('requeues a conflicted or failed item to pending state', async () => {
    const conflictedItem = {
      id: 'conflict-1',
      type: 'claim-submission',
      payload: { aidId: 'aid-conf', claimId: 'claim-conf', idempotencyKey: 'idem-conf' },
      state: 'conflict',
      retryCount: 1,
      maxRetries: 5,
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: 'HTTP 409 Conflict',
    };
    await seedStorage([conflictedItem]);

    const { getSyncQueueState, requeueAction } = loadFreshQueue();
    await requeueAction('conflict-1');

    const stateAfter = await getSyncQueueState();
    expect(stateAfter.items[0].state).toBe('pending');
    expect(stateAfter.items[0].retryCount).toBe(0);
    expect(stateAfter.items[0].lastError).toBeNull();
  });
});

// ── SubmissionStatusBadge ─────────────────────────────────────────────────────

jest.mock('../contexts/SyncContext', () => ({
  useSync: jest.fn(() => ({
    items: [
      {
        id: 'queued-claim-1',
        type: 'claim-submission',
        payload: {
          aidId: 'aid-1',
          claimId: 'claim-1',
          idempotencyKey: 'idem-queued-1',
        },
        state: 'failed',
        retryCount: 2,
        maxRetries: 5,
        nextRetryAt: new Date('2026-06-26T12:00:00.000Z').toISOString(),
        createdAt: new Date('2026-06-26T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-06-26T11:00:00.000Z').toISOString(),
        lastError: 'HTTP error! status: 503',
      },
    ],
    isSyncing: false,
    isConnected: true,
    lastSyncAt: new Date('2026-06-26T11:30:00.000Z').toISOString(),
    lastSyncError: 'HTTP error! status: 503',
    pendingCount: 1,
    failedCount: 1,
    conflictCount: 0,
    flushNow: jest.fn(),
    retryAction: jest.fn(),
    requeueAction: jest.fn(),
    discardAction: jest.fn(),
    clearQueue: jest.fn(),
  })),
}));

jest.mock('../theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#FFFFFF',
      surface: '#F9FAFB',
      border: '#E5E7EB',
      textPrimary: '#111827',
      textSecondary: '#6B7280',
      primary: '#2563EB',
      error: '#DC2626',
      warningBg: '#FEF3C7',
      warning: '#92400E',
      infoBg: '#DBEAFE',
      info: '#1E40AF',
      successBg: '#D1FAE5',
      success: '#065F46',
      errorBg: '#FEE2E2',
    },
  }),
}));

describe('SubmissionStatusBadge', () => {
  it('shows "Queued" for pending state', () => {
    const { getByText } = render(<SubmissionStatusBadge state="pending" />);
    expect(getByText('Queued')).toBeTruthy();
  });

  it('shows "Retrying" label for retrying state', () => {
    const { getByText } = render(<SubmissionStatusBadge state="retrying" />);
    expect(getByText('Retrying')).toBeTruthy();
  });

  it('shows "Submitted" for submitted state', () => {
    const { getByText } = render(<SubmissionStatusBadge state="submitted" />);
    expect(getByText('Submitted')).toBeTruthy();
  });

  it('shows "Failed" for failed state', () => {
    const { getByText } = render(<SubmissionStatusBadge state="failed" />);
    expect(getByText('Failed')).toBeTruthy();
  });

  it('shows retry button in failed and retrying states', () => {
    const onRetry = jest.fn();
    const { getByTestId: getByTestIdFailed } = render(<SubmissionStatusBadge state="failed" onRetry={onRetry} />);
    expect(getByTestIdFailed('badge-retry-button')).toBeTruthy();

    const { getByTestId: getByTestIdRetrying } = render(<SubmissionStatusBadge state="retrying" onRetry={onRetry} />);
    expect(getByTestIdRetrying('badge-retry-button')).toBeTruthy();
  });

  it('does not show retry button in non-retryable states', () => {
    const onRetry = jest.fn();
    const { queryByTestId } = render(<SubmissionStatusBadge state="pending" onRetry={onRetry} />);
    expect(queryByTestId('badge-retry-button')).toBeNull();
  });

  it('calls onRetry when retry button is pressed', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(<SubmissionStatusBadge state="failed" onRetry={onRetry} />);
    fireEvent.press(getByTestId('badge-retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show retry button when onRetry is not provided', () => {
    const { queryByTestId } = render(<SubmissionStatusBadge state="failed" />);
    expect(queryByTestId('badge-retry-button')).toBeNull();

    const { queryByTestId: queryByTestIdRetrying } = render(<SubmissionStatusBadge state="retrying" />);
    expect(queryByTestIdRetrying('badge-retry-button')).toBeNull();
  });
});

describe('SubmissionQueueScreen', () => {
  it('shows queued submission state on a dedicated screen', () => {
    const { getByText } = render(<SubmissionQueueScreen />);

    expect(getByText('Submission Queue')).toBeTruthy();
    expect(getByText('Online · 1 pending · 1 failed · 0 conflict')).toBeTruthy();
    expect(getByText('Claim Submission')).toBeTruthy();
    expect(getByText('Claim ID: claim-1')).toBeTruthy();
    expect(getByText('Failed')).toBeTruthy();
    expect(getByText('2 / 5')).toBeTruthy();
    expect(getByText('HTTP error! status: 503')).toBeTruthy();
  });
});

// ── Discard confirmation dialogs ──────────────────────────────────────────────

/**
 * These tests verify the acceptance criteria:
 *  - Any discard/clear action requires explicit confirmation naming what will be lost
 *  - The confirmation shows how many items and what type are affected
 *  - Cancelling leaves the queue untouched
 *  - Both single-item and bulk-clear paths are covered
 *
 * The SyncContext mock (defined above for the badge tests) already returns
 * discardAction and clearQueue as jest.fn(). Here we grab fresh references via
 * require() after jest mocks are applied and control them through beforeEach.
 */

describe('SubmissionQueueScreen – discard confirmation', () => {
  let alertSpy: jest.SpyInstance;
  let mockDiscardAction: jest.Mock;
  let mockClearQueue: jest.Mock;
  let useSyncSpy: jest.SpyInstance;

  // Two-item queue so the bulk-clear message can reference count and both types.
  const twoItemQueue = [
    {
      id: 'confirm-item-1',
      type: 'claim-submission',
      payload: { aidId: 'aid-2', claimId: 'claim-2', idempotencyKey: 'idem-confirm-1' },
      state: 'failed',
      retryCount: 1,
      maxRetries: 5,
      nextRetryAt: new Date('2026-06-26T12:00:00.000Z').toISOString(),
      createdAt: new Date('2026-06-26T10:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-06-26T11:00:00.000Z').toISOString(),
      lastError: 'HTTP error! status: 503',
    },
    {
      id: 'confirm-item-2',
      type: 'evidence-upload',
      payload: { aidId: 'aid-3', url: 'https://example.com/upload' },
      state: 'pending',
      retryCount: 0,
      maxRetries: 5,
      nextRetryAt: new Date('2026-06-26T12:00:00.000Z').toISOString(),
      createdAt: new Date('2026-06-26T10:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-06-26T11:00:00.000Z').toISOString(),
      lastError: null,
    },
  ];

  beforeEach(() => {
    mockDiscardAction = jest.fn();
    mockClearQueue = jest.fn();

    // Override useSync for this describe block by spying on the already-mocked module.
    const SyncContextModule = require('../contexts/SyncContext');
    useSyncSpy = jest.spyOn(SyncContextModule, 'useSync').mockImplementation(() => ({
      items: twoItemQueue,
      isSyncing: false,
      isConnected: true,
      lastSyncAt: null,
      lastSyncError: null,
      pendingCount: 1,
      failedCount: 1,
      conflictCount: 0,
      flushNow: jest.fn(),
      retryAction: jest.fn(),
      requeueAction: jest.fn(),
      discardAction: mockDiscardAction,
      clearQueue: mockClearQueue,
    }));

    // Spy on Alert.alert so we can inspect calls and simulate button presses.
    alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
  });

  afterEach(() => {
    useSyncSpy.mockRestore();
    alertSpy.mockRestore();
  });

  // ── single-item discard ───────────────────────────────────────────────────

  it('shows a confirmation dialog when the discard button is pressed', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('discard-button-confirm-item-1'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message] = alertSpy.mock.calls[0];
    expect(title).toBe('Discard Queued Item?');
    // Message must name the item type
    expect(message).toContain('Claim Submission');
  });

  it('does NOT call discardAction before the user confirms', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('discard-button-confirm-item-1'));

    // Alert was shown but user has not tapped a button yet
    expect(mockDiscardAction).not.toHaveBeenCalled();
  });

  it('calls discardAction with the correct id after the user confirms', async () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('discard-button-confirm-item-1'));

    // Simulate the user pressing the destructive "Discard" button
    const buttons: { text: string; onPress?: () => void }[] = alertSpy.mock.calls[0][2];
    const confirmBtn = buttons.find((b) => b.text === 'Discard');
    expect(confirmBtn).toBeDefined();
    await confirmBtn!.onPress?.();

    expect(mockDiscardAction).toHaveBeenCalledTimes(1);
    expect(mockDiscardAction).toHaveBeenCalledWith('confirm-item-1');
  });

  it('does NOT call discardAction when the user cancels the dialog', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('discard-button-confirm-item-1'));

    const buttons: { text: string; onPress?: () => void; style?: string }[] = alertSpy.mock.calls[0][2];
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    expect(cancelBtn).toBeDefined();
    cancelBtn!.onPress?.();

    expect(mockDiscardAction).not.toHaveBeenCalled();
  });

  // ── modal footer discard ──────────────────────────────────────────────────

  it('shows a confirmation dialog when discard is pressed inside the inspect modal', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    // Open the inspect modal for the first item, then press Discard in the footer.
    fireEvent.press(getByTestId('inspect-button-confirm-item-1'));
    fireEvent.press(getByTestId('modal-discard-button'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message] = alertSpy.mock.calls[0];
    expect(title).toBe('Discard Queued Item?');
    expect(message).toContain('Claim Submission');
  });

  it('does NOT call discardAction when the modal discard dialog is cancelled', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('inspect-button-confirm-item-1'));
    fireEvent.press(getByTestId('modal-discard-button'));

    const buttons: { text: string; onPress?: () => void; style?: string }[] = alertSpy.mock.calls[0][2];
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    cancelBtn!.onPress?.();

    expect(mockDiscardAction).not.toHaveBeenCalled();
  });

  // ── bulk clear ────────────────────────────────────────────────────────────

  it('renders the Clear All button when there are items in the queue', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);
    expect(getByTestId('clear-all-button')).toBeTruthy();
  });

  it('shows a bulk confirmation dialog naming the count and types when Clear All is pressed', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('clear-all-button'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message] = alertSpy.mock.calls[0];
    expect(title).toBe('Clear All Queued Items?');
    // Must state total count and both affected types
    expect(message).toContain('2');
    expect(message).toContain('Claim Submission');
    expect(message).toContain('Evidence Upload');
  });

  it('does NOT call clearQueue before the user confirms the bulk dialog', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('clear-all-button'));

    expect(mockClearQueue).not.toHaveBeenCalled();
  });

  it('calls clearQueue after the user confirms the bulk dialog', async () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('clear-all-button'));

    const buttons: { text: string; onPress?: () => void }[] = alertSpy.mock.calls[0][2];
    const confirmBtn = buttons.find((b) => b.text === 'Clear All');
    expect(confirmBtn).toBeDefined();
    await confirmBtn!.onPress?.();

    expect(mockClearQueue).toHaveBeenCalledTimes(1);
  });

  it('does NOT call clearQueue when the bulk dialog is cancelled', () => {
    const { getByTestId } = render(<SubmissionQueueScreen />);

    fireEvent.press(getByTestId('clear-all-button'));

    const buttons: { text: string; onPress?: () => void; style?: string }[] = alertSpy.mock.calls[0][2];
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    expect(cancelBtn).toBeDefined();
    cancelBtn!.onPress?.();

    expect(mockClearQueue).not.toHaveBeenCalled();
  });
});
