import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ReviewQueueFilters,
  ReviewQueueResponse,
  ReviewCaseDetail,
  ReviewCase,
} from '@/types/review-case';
import {
  fetchReviewQueue,
  fetchReviewCase,
  approveReviewCase,
  rejectReviewCase,
  ReviewApiError,
} from '@/lib/review-api';

const REVIEW_QUEUE_KEY = 'review-queue';
const REVIEW_CASE_KEY = 'review-case';

export function useReviewQueue(
  filters: ReviewQueueFilters & { page?: number; limit?: number } = {},
) {
  return useQuery<ReviewQueueResponse, ReviewApiError>({
    queryKey: [REVIEW_QUEUE_KEY, filters],
    queryFn: () => fetchReviewQueue(filters),
    staleTime: 30 * 1000,
  });
}

export function useReviewCase(id: string | null) {
  return useQuery<ReviewCaseDetail, ReviewApiError>({
    queryKey: [REVIEW_CASE_KEY, id],
    queryFn: () => fetchReviewCase(id!),
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

export function useApproveReviewCase() {
  const queryClient = useQueryClient();

  return useMutation<
    ReviewCaseDetail,
    ReviewApiError,
    { id: string; notes?: string }
  >({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      approveReviewCase(id, notes),
    onMutate: async ({ id }: { id: string; notes?: string }) => {
      await queryClient.cancelQueries({ queryKey: [REVIEW_CASE_KEY, id] });
      await queryClient.cancelQueries({ queryKey: [REVIEW_QUEUE_KEY] });

      const previousCase = queryClient.getQueryData<ReviewCaseDetail>([
        REVIEW_CASE_KEY,
        id,
      ]);
      const previousQueue = queryClient.getQueryData<ReviewQueueResponse>([
        REVIEW_QUEUE_KEY,
      ]);

      // Optimistically update the case
      if (previousCase) {
        queryClient.setQueryData<ReviewCaseDetail>([REVIEW_CASE_KEY, id], {
          ...previousCase,
          status: 'approved',
          reviewedAt: new Date().toISOString(),
        });
      }

      // Optimistically update the queue
      queryClient.setQueriesData<ReviewQueueResponse>(
        { queryKey: [REVIEW_QUEUE_KEY] },
        (old: ReviewQueueResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item: ReviewCase) =>
              item.id === id
                ? {
                    ...item,
                    status: 'approved' as const,
                    reviewedAt: new Date().toISOString(),
                  }
                : item,
            ),
          };
        },
      );

      return { previousCase, previousQueue };
    },
    onError: (
      _err: ReviewApiError,
      { id }: { id: string; notes?: string },
      context: { previousCase?: ReviewCaseDetail; previousQueue?: ReviewQueueResponse } | undefined,
    ) => {
      if (context?.previousCase) {
        queryClient.setQueryData([REVIEW_CASE_KEY, id], context.previousCase);
      }
      if (context?.previousQueue) {
        queryClient.setQueryData([REVIEW_QUEUE_KEY], context.previousQueue);
      }
    },
    onSettled: (
      _data: ReviewCaseDetail | undefined,
      _error: ReviewApiError | null,
      { id }: { id: string; notes?: string },
    ) => {
      queryClient.invalidateQueries({ queryKey: [REVIEW_CASE_KEY, id] });
      queryClient.invalidateQueries({ queryKey: [REVIEW_QUEUE_KEY] });
    },
  });
}

export function useRejectReviewCase() {
  const queryClient = useQueryClient();

  return useMutation<
    ReviewCaseDetail,
    ReviewApiError,
    { id: string; notes?: string }
  >({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      rejectReviewCase(id, notes),
    onMutate: async ({ id }: { id: string; notes?: string }) => {
      await queryClient.cancelQueries({ queryKey: [REVIEW_CASE_KEY, id] });
      await queryClient.cancelQueries({ queryKey: [REVIEW_QUEUE_KEY] });

      const previousCase = queryClient.getQueryData<ReviewCaseDetail>([
        REVIEW_CASE_KEY,
        id,
      ]);
      const previousQueue = queryClient.getQueryData<ReviewQueueResponse>([
        REVIEW_QUEUE_KEY,
      ]);

      // Optimistically update the case
      if (previousCase) {
        queryClient.setQueryData<ReviewCaseDetail>([REVIEW_CASE_KEY, id], {
          ...previousCase,
          status: 'rejected',
          reviewedAt: new Date().toISOString(),
        });
      }

      // Optimistically update the queue
      queryClient.setQueriesData<ReviewQueueResponse>(
        { queryKey: [REVIEW_QUEUE_KEY] },
        (old: ReviewQueueResponse | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item: ReviewCase) =>
              item.id === id
                ? {
                    ...item,
                    status: 'rejected' as const,
                    reviewedAt: new Date().toISOString(),
                  }
                : item,
            ),
          };
        },
      );

      return { previousCase, previousQueue };
    },
    onError: (
      _err: ReviewApiError,
      { id }: { id: string; notes?: string },
      context: { previousCase?: ReviewCaseDetail; previousQueue?: ReviewQueueResponse } | undefined,
    ) => {
      if (context?.previousCase) {
        queryClient.setQueryData([REVIEW_CASE_KEY, id], context.previousCase);
      }
      if (context?.previousQueue) {
        queryClient.setQueryData([REVIEW_QUEUE_KEY], context.previousQueue);
      }
    },
    onSettled: (
      _data: ReviewCaseDetail | undefined,
      _error: ReviewApiError | null,
      { id }: { id: string; notes?: string },
    ) => {
      queryClient.invalidateQueries({ queryKey: [REVIEW_CASE_KEY, id] });
      queryClient.invalidateQueries({ queryKey: [REVIEW_QUEUE_KEY] });
    },
  });
}
