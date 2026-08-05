'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type {
  ContractRegistryResponse,
  ContractRegistryEntry,
  ContractRegistryResult,
  ContractRegistryState,
} from '@/types/contract-registry';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const POLL_INTERVAL_MS = 60_000;

async function fetchContractRegistry(): Promise<ContractRegistryResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchClient(`${API_URL}/contract-registry`, {
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Contract registry endpoint returned ${response.status}`);
    }

    return response.json() as Promise<ContractRegistryResponse>;
  } finally {
    clearTimeout(timeoutId);
  }
}

function deriveState(
  hasData: boolean,
  isLoading: boolean,
  isError: boolean,
): ContractRegistryState {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (hasData) return 'ready';
  return 'error';
}

export function useContractRegistry(): ContractRegistryResult & {
  getContract: (name: string, network?: string) => ContractRegistryEntry | null;
} {
  const { data, error, isLoading, dataUpdatedAt } = useQuery<
    ContractRegistryResponse,
    Error
  >({
    queryKey: ['contract-registry'],
    queryFn: fetchContractRegistry,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: 1,
    staleTime: POLL_INTERVAL_MS,
  });

  const state = deriveState(!!data, isLoading, !!error);
  const lastChecked = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const getContract = (name: string, network?: string): ContractRegistryEntry | null => {
    if (!data?.contracts?.[name]) return null;
    const entry = data.contracts[name];
    if (!network) return entry;
    return entry.networks?.[network] ? entry : null;
  };

  return {
    state,
    data: data ?? null,
    error: error ?? null,
    lastChecked,
    getContract,
  };
}
