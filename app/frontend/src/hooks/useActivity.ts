import { useActivityStore } from '@/lib/activityStore';
import type { ActivityItem } from '@/types/activity';

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
      onSuccess?: (result: any) => void;
      onError?: (error: Error) => void;
    }
  ) => {
    const activityId = crypto.randomUUID();

    // Add pending activity
    addActivity({
      id: activityId,
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
      updateActivity(activityId, {
        status: 'failed',
        currentStep: 'Transaction failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      options?.onError?.(error);
      throw error;
    }
  };

  const trackJob = async (
    title: string,
    description: string,
    action: () => Promise<any>,
    options?: {
      retryAction?: () => Promise<any>;
      onSuccess?: (result: any) => void;
      onError?: (error: Error) => void;
    }
  ) => {
    const activityId = crypto.randomUUID();

    // Add pending activity
    addActivity({
      id: activityId,
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
      updateActivity(activityId, {
        status: 'failed',
        currentStep: 'Failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      options?.onError?.(error);
      throw error;
    }
  };

  return { trackTransaction, trackJob };
}