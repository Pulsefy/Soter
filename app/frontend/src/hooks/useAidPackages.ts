'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type { AidPackage, AidPackageFilters } from '@/types/aid-package';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchAidPackages(filters?: AidPackageFilters): Promise<AidPackage[]> {
  const perfEnabled =
    typeof window !== 'undefined' && process.env.NEXT_PUBLIC_DASHBOARD_PERF === '1';
  const start = perfEnabled ? performance.now() : 0;

  const params = new URLSearchParams();

  if (filters?.search) params.set('search', filters.search);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.token) params.set('token', filters.token);

  const query = params.toString();
  const url = `${API_URL}/aid-packages${query ? `?${query}` : ''}`;

  const response = await fetchClient(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch aid packages: ${response.status}`);
  }
  const json = await response.json();

  if (perfEnabled) {
    const end = performance.now();
    console.debug(`[perf] fetchAidPackages ${Math.round(end - start)}ms`, {
      search: filters?.search ?? '',
      status: filters?.status ?? '',
      token: filters?.token ?? '',
    });
  }

  return json;
}

export function useAidPackages(filters?: AidPackageFilters) {
  const search = filters?.search ?? '';
  const status = filters?.status ?? '';
  const token = filters?.token ?? '';

  return useQuery({
    queryKey: ['aid-packages', search, status, token],
    queryFn: () => fetchAidPackages(filters),
  });
}
