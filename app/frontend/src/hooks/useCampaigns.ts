'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type {
  Campaign,
  CampaignCreatePayload,
  CampaignUpdatePayload,
  CampaignStatus,
} from '@/types/campaign';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: unknown;
}

interface OptimisticUpdateContext {
  previousCampaigns: Campaign[];
  campaignId: string;
  previousStatus?: CampaignStatus;
}

async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await fetchClient(`${API_URL}/campaigns`);
  if (!res.ok) {
    throw new Error(`Failed to fetch campaigns: ${res.status}`);
  }

  const body = (await res.json()) as ApiResponse<Campaign[]>;
  if (!body.success) {
    throw new Error(body.message ?? 'Failed to fetch campaigns');
  }

  return body.data ?? [];
}

async function postCampaign(payload: CampaignCreatePayload): Promise<Campaign> {
  const res = await fetchClient(`${API_URL}/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (![200, 201].includes(res.status)) {
    const body = await res.json();
    throw new Error(body?.message ?? `Failed to create campaign: ${res.status}`);
  }

  const body = (await res.json()) as ApiResponse<Campaign>;
  if (!body.success) {
    throw new Error(body.message ?? 'Failed to create campaign');
  }

  return body.data as Campaign;
}

async function patchCampaign(id: string, payload: CampaignUpdatePayload): Promise<Campaign> {
  const res = await fetchClient(`${API_URL}/campaigns/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

export function useCampaigns() {
  return useQuery({ queryKey: ['campaigns'], queryFn: fetchCampaigns });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: CampaignUpdatePayload }) =>
      patchCampaign(id, data),
    
    // Optimistic update
    onMutate: async ({ id, data }: { id: string; data: CampaignUpdatePayload }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['campaigns'] });

      // Snapshot the previous value
      const previousCampaigns = queryClient.getQueryData<Campaign[]>(['campaigns']) ?? [];

      // Optimistically update to the new value
      queryClient.setQueryData<Campaign[]>(['campaigns'], (old: Campaign[] | undefined) => {
        if (!old) return old;
        return old.map((campaign: Campaign) =>
          campaign.id === id ? { ...campaign, ...data } : campaign
        );
      });

      // Return context with the snapshotted value
      return { 
        previousCampaigns, 
        campaignId: id, 
        previousStatus: previousCampaigns.find((c: Campaign) => c.id === id)?.status 
      };
    },

    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err: Error, variables: { id: string; data: CampaignUpdatePayload }, context: OptimisticUpdateContext | undefined) => {
      if (context?.previousCampaigns) {
        queryClient.setQueryData(['campaigns'], context.previousCampaigns);
      }
    },

    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useArchiveCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchClient(`${API_URL}/campaigns/${id}/archive`, {
        method: 'PATCH',
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.message ?? `Failed to archive campaign: ${res.status}`);
      }

      const body = (await res.json()) as ApiResponse<Campaign>;
      if (!body.success) {
        throw new Error(body.message ?? 'Failed to archive campaign');
      }

      return body.data as Campaign;
    },

    // Optimistic update
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['campaigns'] });

      const previousCampaigns = queryClient.getQueryData<Campaign[]>(['campaigns']) ?? [];

      queryClient.setQueryData<Campaign[]>(['campaigns'], (old: Campaign[] | undefined) => {
        if (!old) return old;
        return old.map((campaign: Campaign) =>
          campaign.id === id ? { ...campaign, status: 'archived' as CampaignStatus } : campaign
        );
      });

      return { previousCampaigns, campaignId: id };
    },

    onError: (err: Error, id: string, context: OptimisticUpdateContext | undefined) => {
      if (context?.previousCampaigns) {
        queryClient.setQueryData(['campaigns'], context.previousCampaigns);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
