'use client';

import { useQuery } from '@tanstack/react-query';
import { resolveApiUrl } from '@/lib/api-client';

/** Backpressure is a soft signal; polling every 15s is plenty. */
const POLL_INTERVAL_MS = 15_000;

export type BackpressureLevel = 'normal' | 'elevated' | 'critical';

export interface BackpressureState {
  active: boolean;
  level: BackpressureLevel;
}

const INACTIVE: BackpressureState = { active: false, level: 'normal' };

async function fetchBackpressure(): Promise<BackpressureState> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(
      `${resolveApiUrl()}/api/v1/jobs/backpressure`,
      { cache: 'no-store', signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const body = (await response.json()) as Partial<BackpressureState>;
    return { active: body.active === true, level: body.level ?? 'normal' };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Polls the backend job-queue backpressure signal. Failures resolve to
 * "inactive": the notice is advisory and must never block or alarm the user
 * just because the signal itself is unreachable.
 */
export function useQueueBackpressure(): BackpressureState {
  const { data } = useQuery<BackpressureState, Error>({
    queryKey: ['queue-backpressure'],
    queryFn: fetchBackpressure,
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
    staleTime: POLL_INTERVAL_MS,
  });
  return data ?? INACTIVE;
}
