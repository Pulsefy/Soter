import { apiClient } from './api-client';
import type { components } from '@/types/generated/api';

export type VerificationInboxItemDto = components['schemas']['VerificationInboxItemDto'];
export type VerificationInboxResponseDto = components['schemas']['VerificationInboxResponseDto'];

export async function fetchVerificationInbox(params?: { page?: number; limit?: number; status?: string }) {
  const { data, error } = await apiClient.GET('/api/v1/verification-inbox', {
    params: { query: params },
  });

  if (error) {
    throw new Error(`Failed to fetch verification inbox: ${JSON.stringify(error)}`);
  }

  return data;
}