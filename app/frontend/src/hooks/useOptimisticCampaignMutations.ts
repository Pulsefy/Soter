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

export type CampaignAction = 
  | { type: 'pause'; targetStatus: 'paused' }
  | { type: 'resume'; targetStatus: 'active' }
  | { type: 'archive'; targetStatus: 'archived' }
  | { type: 'complete'; targetStatus: 'completed' }
  | { type: 'activate'; targetStatus: 'active' };

const ACTION_CONFIG: Record<CampaignAction['type'], { targetStatus: CampaignStatus; pastTense: string; presentTense: string }> = {
  pause: { targetStatus: 'paused', pastTense: 'paused', presentTense: 'pausing' },
  resume: { targetStatus: 'active', pastTense: 'resumed', presentTense: 'resuming' },
  archive: { targetStatus: 'archived', pastTense: 'archived', presentTense: 'archiving' },
  complete: { targetStatus: 'completed', pastTense: 'completed', presentTense: 'completing' },
  activate: { targetStatus: 'active', pastTense: 'activated', presentTense: 'activating' },
};

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

interface MutationVariables {
  id: string;
  campaignName: string;
  action: CampaignAction;
}

interface MutationContext {
  previousCampaigns: Campaign[] | undefined;
  campaignName: string;
  action: CampaignAction;
}

export function useOptimisticCampaignAction({
  onSuccess,
  onError,
}: {
  onSuccess?: (action: CampaignAction, campaignName: string) => void;
  onError?: (action: CampaignAction, campaignName: string, error: Error) => void;
} = {}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<Campaign, Error, MutationVariables, MutationContext>({
    mutationKey: ['campaigns', 'optimistic-action'],
    mutationFn: async ({ id, action }: MutationVariables) => {
      const config = ACTION_CONFIG[action.type];
      return updateCampaignStatus(id, config.targetStatus);
    },

    onMutate: async ({ id, campaignName, action }: MutationVariables) => {
      const config = ACTION_CONFIG[action.type];

      await queryClient.cancelQueries({ queryKey: ['campaigns'] });

      const previousCampaigns = queryClient.getQueryData<Campaign[]>(['campaigns']);

      queryClient.setQueryData<Campaign[]>(['campaigns'], (old) => {
        if (!old) return old;
        return old.map((campaign) =>
          campaign.id === id
            ? { ...campaign, status: config.targetStatus }
            : campaign
        );
      });

      return {
        previousCampaigns,
        campaignName,
        action,
      };
    },

    onSuccess: (_data, variables: MutationVariables) => {
      const { campaignName, action } = variables;
      const config = ACTION_CONFIG[action.type];

      queryClient.invalidateQueries({ queryKey: ['campaigns'] });

      onSuccess?.(action, campaignName);

      toast(
        `Campaign ${config.pastTense}`,
        `"${campaignName}" has been ${config.pastTense}.`,
        'success'
      );
    },

    onError: (error, variables: MutationVariables, context: MutationContext | undefined) => {
      const { campaignName, action } = variables;
      const config = ACTION_CONFIG[action.type];

      if (context?.previousCampaigns) {
        queryClient.setQueryData<Campaign[]>(
          ['campaigns'],
          context.previousCampaigns
        );
      }

      onError?.(action, campaignName, error);

      toast(
        `Failed to ${action.type} campaign`,
        error instanceof Error ? error.message : `Could not ${config.presentTense} "${campaignName}". Please try again.`,
        'error'
      );
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function usePauseCampaign() {
  return useOptimisticCampaignAction({
    onSuccess: (action, name) => {
      console.log(`[Campaign] Paused: ${name}`);
    },
    onError: (action, name, error) => {
      console.error(`[Campaign] Failed to pause "${name}":`, error);
    },
  });
}

export function useResumeCampaign() {
  return useOptimisticCampaignAction({
    onSuccess: (action, name) => {
      console.log(`[Campaign] Resumed: ${name}`);
    },
    onError: (action, name, error) => {
      console.error(`[Campaign] Failed to resume "${name}":`, error);
    },
  });
}

export function useArchiveCampaign() {
  return useOptimisticCampaignAction({
    onSuccess: (action, name) => {
      console.log(`[Campaign] Archived: ${name}`);
    },
    onError: (action, name, error) => {
      console.error(`[Campaign] Failed to archive "${name}":`, error);
    },
  });
}

export function useCampaignAction() {
  return useOptimisticCampaignAction();
}

export function useCampaignActions(currentStatus: CampaignStatus) {
  return {
    canPause: currentStatus === 'active',
    canResume: currentStatus === 'paused',
    canArchive: currentStatus === 'active' || currentStatus === 'paused' || currentStatus === 'completed',
    canComplete: currentStatus === 'active' || currentStatus === 'paused',
    canActivate: currentStatus === 'draft',
  };
}
