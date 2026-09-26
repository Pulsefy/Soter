'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type {
  RunbookResponse,
  RunbookResult,
  RunbookState,
} from '@/types/runbook';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const POLL_INTERVAL_MS = 120_000;

async function fetchRunbook(): Promise<RunbookResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchClient(`${API_URL}/runbook`, {
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Runbook endpoint returned ${response.status}`);
    }

    return response.json() as Promise<RunbookResponse>;
  } finally {
    clearTimeout(timeoutId);
  }
}

function deriveState(
  hasData: boolean,
  isLoading: boolean,
  isError: boolean,
): RunbookState {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (hasData) return 'ready';
  return 'error';
}

export function useRunbook(): RunbookResult {
  const { data, error, isLoading, dataUpdatedAt } = useQuery<
    RunbookResponse,
    Error
  >({
    queryKey: ['runbook'],
    queryFn: fetchRunbook,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 1,
    staleTime: POLL_INTERVAL_MS,
  });

  const state = deriveState(!!data, isLoading, !!error);
  const lastChecked = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return {
    state,
    data: data ?? null,
    error: error ?? null,
    lastChecked,
  };
}
