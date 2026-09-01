'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchInbox,
  fetchStats,
  fetchDetails,
  fetchNotes,
  approveVerification,
  rejectVerification,
  requestResubmission,
  addNote,
} from '@/lib/verification-inbox-api';
import type {
  ReviewFilters,
  VerificationInboxItem,
} from '@/types/verification-review';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const inboxKeys = {
  all: ['verification-inbox'] as const,
  list: (filters: Partial<ReviewFilters>) =>
    [...inboxKeys.all, 'list', filters] as const,
  stats: () => [...inboxKeys.all, 'stats'] as const,
  detail: (id: string) => [...inboxKeys.all, 'detail', id] as const,
  notes: (id: string) => [...inboxKeys.all, 'notes', id] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function useInbox(filters: Partial<ReviewFilters>) {
  return useQuery({
    queryKey: inboxKeys.list(filters),
    queryFn: () => fetchInbox(filters),
    // Surface the most recent data while a background refetch is running
    placeholderData: previousData => previousData,
  });
}

export function useInboxStats() {
  return useQuery({
    queryKey: inboxKeys.stats(),
    queryFn: fetchStats,
    refetchInterval: 30_000, // refresh stats every 30s
    // Keep previous data visible while the interval refetch runs
    placeholderData: previousData => previousData,
  });
}

// ---------------------------------------------------------------------------
// Latency store — a virtual query key that holds the last fetch duration.
// Components subscribe to it reactively through useOptimisticItemState-style reads.
// ---------------------------------------------------------------------------

const latencyStoreKey = ['verification-inbox', '__latency'] as const;

function setLatency(qc: ReturnType<typeof useQueryClient>, ms: number) {
  qc.setQueryData(latencyStoreKey, ms);
}

// ---------------------------------------------------------------------------
// Refresh status hook — freshness + latency tracking for the queue list
// ---------------------------------------------------------------------------
export interface QueueRefreshStatus {
  /** Timestamp of last successful data fetch (ms since epoch), or 0 if never */
  lastRefreshedAt: number;
  /** Whether a background or manual refetch is in flight */
  isRefreshing: boolean;
  /** Duration in ms of the most recent completed fetch, or null */
  latencyMs: number | null;
  /** Whether the last fetch ended in an error */
  hasError: boolean;
  /** Manually trigger a refetch of the inbox list */
  refresh: () => void;
}

export function useQueueRefreshStatus(
  filters: Partial<ReviewFilters>,
): QueueRefreshStatus {
  const qc = useQueryClient();

  // Subscribe to latency store reactively
  const latencyMs = useQuery({
    queryKey: latencyStoreKey,
    queryFn: () => null as number | null,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }).data ?? null;

  // Observe the live inbox query state (owned by useInbox above)
  const state = qc.getQueryState(inboxKeys.list(filters));

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: inboxKeys.list(filters) });
  }, [qc, filters]);

  return {
    lastRefreshedAt: state?.dataUpdatedAt ?? 0,
    isRefreshing: state?.fetchStatus === 'fetching',
    latencyMs,
    hasError: state?.status === 'error',
    refresh,
  };
}

// ---------------------------------------------------------------------------
// Latency-aware inbox hook — wraps useInbox to record fetch duration.
// Use this instead of useInbox on the ReviewQueue page to get latency tracking.
// ---------------------------------------------------------------------------
export function useInboxWithLatency(filters: Partial<ReviewFilters>) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: inboxKeys.list(filters),
    queryFn: async () => {
      const start = Date.now();
      const result = await fetchInbox(filters);
      setLatency(qc, Date.now() - start);
      return result;
    },
    placeholderData: previousData => previousData,
  });
}

export function useVerificationDetail(id: string) {
  return useQuery({
    queryKey: inboxKeys.detail(id),
    queryFn: () => fetchDetails(id),
    enabled: !!id,
  });
}

export function useVerificationNotes(id: string) {
  return useQuery({
    queryKey: inboxKeys.notes(id),
    queryFn: () => fetchNotes(id),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Optimistic item state store — tracks pending/failed item IDs in the cache
// so any component can read them without prop-drilling.
// ---------------------------------------------------------------------------

/**
 * Virtual query key used as a lightweight reactive store for optimistic UI
 * states across all review actions.
 */
export const optimisticStateKey = ['verification-inbox', '__optimistic'] as const;

export interface OptimisticItemState {
  /** Items currently in-flight (action submitted, awaiting server response) */
  pendingIds: Set<string>;
  /** Items whose last action ended in an error (before the next refetch clears them) */
  failedIds: Set<string>;
}

function getOptimisticState(qc: ReturnType<typeof useQueryClient>): OptimisticItemState {
  return (
    (qc.getQueryData(optimisticStateKey) as OptimisticItemState | undefined) ?? {
      pendingIds: new Set(),
      failedIds: new Set(),
    }
  );
}

function setOptimisticState(
  qc: ReturnType<typeof useQueryClient>,
  updater: (prev: OptimisticItemState) => OptimisticItemState,
) {
  qc.setQueryData(optimisticStateKey, updater(getOptimisticState(qc)));
}

/** Subscribe to the optimistic item state from any component. */
export function useOptimisticItemState(): OptimisticItemState {
  return (
    (useQuery({
      queryKey: optimisticStateKey,
      queryFn: () => ({ pendingIds: new Set<string>(), failedIds: new Set<string>() }),
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }).data as OptimisticItemState | undefined) ?? {
      pendingIds: new Set(),
      failedIds: new Set(),
    }
  );
}

// ---------------------------------------------------------------------------
// Mutations — all with optimistic updates
// ---------------------------------------------------------------------------

function useReviewMutation(
  mutationFn: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<VerificationInboxItem>,
  targetStatus: VerificationInboxItem['status'],
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => mutationFn(id, payload),

    // Optimistic: flip the item's status immediately in every cached list
    // and mark the item as pending in the optimistic state store.
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: inboxKeys.all });

      // Mark as pending, clear any previous failure for this item
      setOptimisticState(qc, prev => {
        const pendingIds = new Set(prev.pendingIds);
        const failedIds = new Set(prev.failedIds);
        pendingIds.add(id);
        failedIds.delete(id);
        return { pendingIds, failedIds };
      });

      // Snapshot all list queries for rollback
      const snapshots = qc.getQueriesData<{ items: VerificationInboxItem[] }>({
        queryKey: inboxKeys.all,
      });

      qc.setQueriesData<{ items: VerificationInboxItem[] }>(
        { queryKey: inboxKeys.all },
        old => {
          if (!old || !('items' in old)) return old;
          return {
            ...old,
            items: old.items.map(item =>
              item.id === id ? { ...item, status: targetStatus } : item,
            ),
          };
        },
      );

      return { snapshots, id };
    },

    // Rollback on error and mark item as failed
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [queryKey, data] of context.snapshots) {
          qc.setQueryData(queryKey, data);
        }
      }
      if (context?.id) {
        setOptimisticState(qc, prev => {
          const pendingIds = new Set(prev.pendingIds);
          const failedIds = new Set(prev.failedIds);
          pendingIds.delete(context.id);
          failedIds.add(context.id);
          return { pendingIds, failedIds };
        });
      }
    },

    // Always refetch to sync server truth; clear pending/failed on settle
    onSettled: (_data, _err, vars) => {
      const id = vars?.id;
      if (id) {
        setOptimisticState(qc, prev => {
          const pendingIds = new Set(prev.pendingIds);
          pendingIds.delete(id);
          return { ...prev, pendingIds };
        });
      }
      void qc.invalidateQueries({ queryKey: inboxKeys.all });
    },
  });
}

export function useApproveVerification() {
  return useReviewMutation(
    (id, payload) =>
      approveVerification(
        id,
        payload as { nextStepMessage?: string; internalNote?: string },
      ),
    'approved',
  );
}

export function useRejectVerification() {
  return useReviewMutation(
    (id, payload) =>
      rejectVerification(
        id,
        payload as {
          rejectionReason: string;
          nextStepMessage?: string;
          internalNote?: string;
        },
      ),
    'rejected',
  );
}

export function useRequestResubmission() {
  return useReviewMutation(
    (id, payload) =>
      requestResubmission(
        id,
        payload as {
          rejectionReason: string;
          nextStepMessage: string;
          internalNote?: string;
        },
      ),
    'needs_resubmission',
  );
}

export function useAddNote(verificationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { content: string; category?: string }) =>
      addNote(verificationId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inboxKeys.notes(verificationId) });
    },
  });
}
