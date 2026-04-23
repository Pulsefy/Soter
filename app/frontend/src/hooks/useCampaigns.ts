'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type {
  Campaign,
  CampaignCreatePayload,
  CampaignUpdatePayload,
} from '@/types/campaign';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: unknown;
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
