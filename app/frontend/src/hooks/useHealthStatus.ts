'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type {
  BackendHealthResponse,
  HealthState,
  HealthStatusResult,
} from '@/types/health';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Polling interval: 30 seconds — reasonable for a health badge */
const POLL_INTERVAL_MS = 30_000;

async function fetchHealth(): Promise<BackendHealthResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000); // 8 s timeout

  try {
    const response = await fetchClient(`${API_URL}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    return response.json() as Promise<BackendHealthResponse>;
  } finally {
    clearTimeout(timeoutId);
  }
}

function deriveState(
  status: string | undefined,
  isLoading: boolean,
  isError: boolean,
): HealthState {
  if (isLoading) return 'loading';
  if (isError) return 'down';
  if (status === 'ok') return 'ok';
  if (status) return 'degraded';
  return 'down';
}

/**
 * Hook that polls the backend /health endpoint every 30 seconds.
 * Returns a HealthStatusResult — state, raw data, error, and last-checked time.
 */
export function useHealthStatus(): HealthStatusResult {
  const { data, error, isLoading, dataUpdatedAt } = useQuery<
    BackendHealthResponse,
    Error
  >({
    queryKey: ['backend-health'],
    queryFn: fetchHealth,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 1,
    staleTime: POLL_INTERVAL_MS,
  });

  const state = deriveState(data?.status, isLoading, !!error);
  const lastChecked = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return {
    state,
    data: data ?? null,
    error: error ?? null,
    lastChecked,
  };
}
