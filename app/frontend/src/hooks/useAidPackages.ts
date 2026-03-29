'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type { AidPackage, AidPackageFilters } from '@/types/aid-package';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchAidPackages(filters?: AidPackageFilters): Promise<AidPackage[]> {
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
  return response.json();
}

export function useAidPackages(filters?: AidPackageFilters) {
  return useQuery({
    queryKey: ['aid-packages', filters ?? {}],
    queryFn: () => fetchAidPackages(filters),
  });
}
