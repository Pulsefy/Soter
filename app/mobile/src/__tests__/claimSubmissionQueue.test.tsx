/**
 * Tests for:
 *  - syncQueue claim-submission idempotency dedup
 *  - syncQueue retryFailedAction
 *  - SubmissionStatusBadge rendering
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

  it('does not change a non-failed item', async () => {
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
});

// ── SubmissionStatusBadge ─────────────────────────────────────────────────────

jest.mock('../contexts/SyncContext', () => ({
  useSync: () => ({
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
    flushNow: jest.fn(),
    retryAction: jest.fn(),
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

  it('shows retry button only in failed state', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(<SubmissionStatusBadge state="failed" onRetry={onRetry} />);
    expect(getByTestId('badge-retry-button')).toBeTruthy();
  });

  it('does not show retry button in non-failed states', () => {
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
  });
});

describe('SubmissionQueueScreen', () => {
  it('shows queued submission state on a dedicated screen', () => {
    const { getByText } = render(<SubmissionQueueScreen />);

    expect(getByText('Submission Queue')).toBeTruthy();
    expect(getByText('Online · 1 pending · 1 failed')).toBeTruthy();
    expect(getByText('Claim Submission')).toBeTruthy();
    expect(getByText('Claim ID: claim-1')).toBeTruthy();
    expect(getByText('Failed')).toBeTruthy();
    expect(getByText('2 / 5')).toBeTruthy();
    expect(getByText('HTTP error! status: 503')).toBeTruthy();
  });
});
