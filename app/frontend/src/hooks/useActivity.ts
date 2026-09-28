import { useActivityStore } from '@/lib/activityStore';
import { useQuery } from '@tanstack/react-query';
import type { ActivityItem } from '@/types/activity';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The backend serves the activity feed under the global `api` prefix with
 * URI versioning (NestJS `setGlobalPrefix('api')` + `@Version('1')`), so the
 * real path is `/api/v1/notifications/activity-feed`.
 */
const ACTIVITY_FEED_URL = `${API_URL}/api/v1/notifications/activity-feed`;

const FEED_LIMIT = 30;
const REFETCH_INTERVAL_MS = 30_000;

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

/**
 * Raw item shape returned by GET /api/v1/notifications/activity-feed
 * (NotificationsService.ActivityFeedItem). `timestamp` arrives as an
 * ISO-8601 string over the wire and is hydrated to a Date below.
 *
 * `metadata` is present on notification/audit items; keep it optional so a
 * missing field does not break the feed.
 */
interface ActivityFeedItemResponse {
  id: string;
  type: 'notification' | 'audit' | 'review';
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  correlationId?: string;
  linkHref?: string;
  linkLabel?: string;
  metadata?: Record<string, unknown>;
}

function isActivityFeedItem(value: unknown): value is ActivityFeedItemResponse {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.description === 'string' &&
    typeof item.timestamp === 'string'
  );
}

async function fetchActivityFeed(): Promise<ActivityItem[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${ACTIVITY_FEED_URL}?limit=${FEED_LIMIT}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch activity feed: ${res.status}`);
    }

    const body = (await res.json()) as ApiResponse<unknown[]>;
    if (!body.success) {
      throw new Error(body.message ?? 'Failed to fetch activity feed');
    }

    return (body.data ?? []).filter(isActivityFeedItem).map(item => ({
      id: item.id,
      type: item.type,
      status: item.status,
      title: item.title,
      description: item.description,
      timestamp: new Date(item.timestamp),
      read: item.read,
      correlationId: item.correlationId,
      linkHref: item.linkHref,
      linkLabel: item.linkLabel,
      metadata: item.metadata,
    }));
  } finally {
    clearTimeout(timeoutId);
  }
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
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}
