'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type { Campaign, CampaignStatus, CampaignUpdatePayload } from '@/types/campaign';
import { useToast } from '@/components/ToastProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: unknown;
}

/**
 * Campaign action types that can be performed optimistically.
 * These are "safe" mutations where we can predict the outcome.
 */
export type CampaignAction = 
  | { type: 'pause'; targetStatus: 'paused' }
  | { type: 'resume'; targetStatus: 'active' }
  | { type: 'archive'; targetStatus: 'archived' }
  | { type: 'complete'; targetStatus: 'completed' }
  | { type: 'activate'; targetStatus: 'active' };

/**
 * Maps action types to their target statuses and display names.
 */
const ACTION_CONFIG: Record<CampaignAction['type'], { targetStatus: CampaignStatus; pastTense: string; presentTense: string }> = {
  pause: { targetStatus: 'paused', pastTense: 'paused', presentTense: 'pausing' },
  resume: { targetStatus: 'active', pastTense: 'resumed', presentTense: 'resuming' },
  archive: { targetStatus: 'archived', pastTense: 'archived', presentTense: 'archiving' },
  complete: { targetStatus: 'completed', pastTense: 'completed', presentTense: 'completing' },
  activate: { targetStatus: 'active', pastTense: 'activated', presentTense: 'activating' },
};

/**
 * Performs the actual API call to update campaign status.
 */
async function updateCampaignStatus(
  id: string, 
  status: CampaignStatus
): Promise<Campaign> {
  const res = await fetchClient(`${API_URL}/campaigns/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status } as CampaignUpdatePayload),
  });

  if (!res.ok) {
    const body = await res.json();
    throw new Error(body?.message ?? `Failed to update campaign: ${res.status}`);
  }

  const body = (await res.json()) as ApiResponse<Campaign>;
  if (!body.success) {
    throw new Error(body.message ?? 'Failed to update campaign');
  }

  return body.data as Campaign;
}

/**
 * Custom hook for performing optimistic campaign mutations.
 * 
 * Features:
 * - Immediate UI update (optimistic)
 * - Automatic rollback on failure
 * - Standardized toast feedback
 * - Query invalidation on success
 * 
 * @example
 * ```typescript
 * const { mutate: pauseCampaign } = useOptimisticCampaignAction({
 *   onSuccess: () => toast('Campaign paused successfully', 'info'),
 * });
 * 
 * // Usage
 * pauseCampaign({ id: 'campaign-123', action: { type: 'pause', targetStatus: 'paused' } });
 * ```
 */
export function useOptimisticCampaignAction({
  onSuccess,
  onError,
}: {
  onSuccess?: (action: CampaignAction, campaignName: string) => void;
  onError?: (action: CampaignAction, campaignName: string, error: Error) => void;
} = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['campaigns', 'optimistic-action'],
    mutationFn: async ({
      id,
      name,
      action,
    }: {
      id: string;
      name: string;
      action: CampaignAction;
    }) => {
      const config = ACTION_CONFIG[action.type];
      return updateCampaignStatus(id, config.targetStatus);
    },

    // 🚀 Optimistic Update: Called immediately when mutation is triggered
    onMutate: async ({ id, name, action }) => {
      const config = ACTION_CONFIG[action.type];

      // Cancel any outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: ['campaigns'] });

      // Snapshot the previous campaign data for rollback
      const previousCampaigns = queryClient.getQueryData<Campaign[]>(['campaigns']);

      // Optimistically update the campaign status in the cache
      queryClient.setQueryData<Campaign[]>(['campaigns'], (old) => {
        if (!old) return old;
        return old.map((campaign) =>
          campaign.id === id
            ? { ...campaign, status: config.targetStatus }
            : campaign
        );
      });

      // Return context for rollback
      return {
        previousCampaigns,
        campaignName: name,
        action,
      };
    },

    // ✅ Success: Invalidate queries to ensure sync with server
    onSuccess: (_data, variables) => {
      const { campaignName, action } = variables;
      const config = ACTION_CONFIG[action.type];

      // Invalidate to ensure we have latest server state
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });

      // Call custom success handler
      onSuccess?.(action, campaignName);

      // Standardized toast feedback
      toast(
        `Campaign ${config.pastTense}`,
        `"${campaignName}" has been ${config.pastTense}.`,
        'success'
      );
    },

    // ❌ Error: Rollback UI state and show error toast
    onError: (error, variables, context) => {
      const { campaignName, action } = variables;
      const config = ACTION_CONFIG[action.type];

      // Rollback to previous state
      if (context?.previousCampaigns) {
        queryClient.setQueryData<Campaign[]>(
          ['campaigns'],
          context.previousCampaigns
        );
      }

      // Call custom error handler
      onError?.(action, campaignName, error as Error);

      // Standardized error toast
      toast(
        `Failed to ${action.type} campaign`,
        error instanceof Error ? error.message : `Could not ${config.presentTense} "${campaignName}". Please try again.`,
        'error'
      );
    },

    // Always refetch after mutation settles to ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

/**
 * Hook for pausing a campaign.
 * Convenience wrapper around useOptimisticCampaignAction.
 * 
 * @example
 * ```typescript
 * const { mutate: pauseCampaign, isPending } = usePauseCampaign();
 * pauseCampaign({ id: '123', name: 'Emergency Fund' });
 * ```
 */
export function usePauseCampaign() {
  const { toast } = useToast();
  
  return useOptimisticCampaignAction({
    onSuccess: (action, name) => {
      console.log(`[Campaign] Paused: ${name}`);
    },
    onError: (action, name, error) => {
      console.error(`[Campaign] Failed to pause "${name}":`, error);
    },
  });
}

/**
 * Hook for resuming a paused campaign.
 * Convenience wrapper around useOptimisticCampaignAction.
 */
export function useResumeCampaign() {
  const { toast } = useToast();
  
  return useOptimisticCampaignAction({
    onSuccess: (action, name) => {
      console.log(`[Campaign] Resumed: ${name}`);
    },
    onError: (action, name, error) => {
      console.error(`[Campaign] Failed to resume "${name}":`, error);
    },
  });
}

/**
 * Hook for archiving a campaign.
 * Convenience wrapper around useOptimisticCampaignAction.
 */
export function useArchiveCampaign() {
  const { toast } = useToast();
  
  return useOptimisticCampaignAction({
    onSuccess: (action, name) => {
      console.log(`[Campaign] Archived: ${name}`);
    },
    onError: (action, name, error) => {
      console.error(`[Campaign] Failed to archive "${name}":`, error);
    },
  });
}

/**
 * Unified hook for all campaign actions.
 * Provides a single interface for pause, resume, archive, and other actions.
 * 
 * @example
 * ```typescript
 * const { mutate: performCampaignAction } = useCampaignAction();
 * 
 * // Pause
 * performCampaignAction({ id: '123', name: 'Campaign', action: { type: 'pause', targetStatus: 'paused' } });
 * 
 * // Resume
 * performCampaignAction({ id: '123', name: 'Campaign', action: { type: 'resume', targetStatus: 'active' } });
 * 
 * // Archive
 * performCampaignAction({ id: '123', name: 'Campaign', action: { type: 'archive', targetStatus: 'archived' } });
 * ```
 */
export function useCampaignAction() {
  return useOptimisticCampaignAction();
}

/**
 * Hook for checking if a campaign action is available based on current status.
 * 
 * @example
 * ```typescript
 * const { canPause, canResume, canArchive } = useCampaignActions('active');
 * // canPause: true, canResume: false, canArchive: true
 * ```
 */
export function useCampaignActions(currentStatus: CampaignStatus) {
  return {
    canPause: currentStatus === 'active',
    canResume: currentStatus === 'paused',
    canArchive: currentStatus === 'active' || currentStatus === 'paused' || currentStatus === 'completed',
    canComplete: currentStatus === 'active' || currentStatus === 'paused',
    canActivate: currentStatus === 'draft',
  };
}