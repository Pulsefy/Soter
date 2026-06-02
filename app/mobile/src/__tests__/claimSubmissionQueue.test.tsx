/**
 * Tests for:
 *  - syncQueue claim-submission idempotency dedup
 *  - syncQueue retryFailedAction
 *  - SubmissionStatusBadge rendering
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

import { SubmissionStatusBadge } from '../components/SubmissionStatusBadge';

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
