import { useActivityStore } from '@/lib/activityStore';
import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type { ActivityItem } from '@/types/activity';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

async function fetchActivityFeed(): Promise<ActivityItem[]> {
  const res = await fetchClient(`${API_URL}/notifications/activity-feed?limit=30`);
  if (!res.ok) {
    throw new Error(`Failed to fetch activity feed: ${res.status}`);
  }

  const body = (await res.json()) as ApiResponse<ActivityItem[]>;
  if (!body.success) {
    throw new Error(body.message ?? 'Failed to fetch activity feed');
  }

  return (body.data ?? []).map(item => ({
    ...item,
    timestamp: new Date(item.timestamp),
  }));
}

/**
 * Utility functions for managing activities in the activity center.
 */
export function useActivity() {
  const { addActivity, updateActivity } = useActivityStore();

  const trackTransaction = async (
    title: string,
    description: string,
    action: () => Promise<{ transactionHash?: string; explorerUrl?: string }>,
    options?: {
      retryAction?: () => Promise<{ transactionHash?: string; explorerUrl?: string }>;
      onSuccess?: (result: { transactionHash?: string; explorerUrl?: string }) => void;
      onError?: (error: Error) => void;
    }
  ) => {
    // Add pending activity
    const activityId = addActivity({
      type: 'transaction',
      status: 'pending',
      title,
      description,
      currentStep: 'Preparing transaction...',
      retryAction: options?.retryAction,
    });

    try {
      const result = await action();
      updateActivity(activityId, {
        status: 'succeeded',
        currentStep: 'Transaction completed',
        transactionHash: result.transactionHash,
        explorerUrl: result.explorerUrl,
      });
      options?.onSuccess?.(result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      updateActivity(activityId, {
        status: 'failed',
        currentStep: 'Transaction failed',
        errorMessage: err.message,
      });
      options?.onError?.(err);
      throw err;
    }
  };

  const trackJob = async <TResult = unknown>(
    title: string,
    description: string,
    action: () => Promise<TResult>,
    options?: {
      retryAction?: () => Promise<TResult>;
      onSuccess?: (result: TResult) => void;
      onError?: (error: Error) => void;
    }
  ): Promise<TResult> => {
    // Add pending activity
    const activityId = addActivity({
      type: 'job',
      status: 'processing',
      title,
      description,
      currentStep: 'Processing...',
      retryAction: options?.retryAction,
    });

    try {
      const result = await action();
      updateActivity(activityId, {
        status: 'succeeded',
        currentStep: 'Completed successfully',
      });
      options?.onSuccess?.(result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      updateActivity(activityId, {
        status: 'failed',
        currentStep: 'Failed',
        errorMessage: err.message,
      });
      options?.onError?.(err);
      throw err;
    }
  };

  return { trackTransaction, trackJob };
}

export function useActivityFeed() {
  return useQuery({
    queryKey: ['activity-feed'],
    queryFn: fetchActivityFeed,
    refetchInterval: 30000,
  });
}
