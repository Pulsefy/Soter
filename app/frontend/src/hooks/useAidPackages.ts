'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type { AidPackage } from '@/types/aid-package';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchAidPackages(): Promise<AidPackage[]> {
  const response = await fetchClient(`${API_URL}/aid-packages`);
  if (!response.ok) {
    throw new Error(`Failed to fetch aid packages: ${response.status}`);
  }
  return response.json();
}

export function useAidPackages() {
  return useQuery({
    queryKey: ['aid-packages'],
    queryFn: fetchAidPackages,
  });
}
