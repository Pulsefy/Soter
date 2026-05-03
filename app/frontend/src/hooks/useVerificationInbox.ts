'use client';

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
  });
}

export function useInboxStats() {
  return useQuery({
    queryKey: inboxKeys.stats(),
    queryFn: fetchStats,
    refetchInterval: 30_000, // refresh stats every 30s
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
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: inboxKeys.all });

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

      return { snapshots };
    },

    // Rollback on error
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [queryKey, data] of context.snapshots) {
          qc.setQueryData(queryKey, data);
        }
      }
    },

    // Always refetch to sync server truth
    onSettled: () => {
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
