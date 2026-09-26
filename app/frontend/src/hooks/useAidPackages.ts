'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@/lib/mock-api/client';
import type { AidPackage, AidPackageFilters, PaginatedResponse, PaginationParams } from '@/types/aid-package';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface FetchAidPackagesParams {
  filters?: AidPackageFilters;
  pagination?: PaginationParams;
}

async function fetchAidPackages({ filters, pagination }: FetchAidPackagesParams): Promise<PaginatedResponse<AidPackage>> {
  const perfEnabled =
    typeof window !== 'undefined' && process.env.NEXT_PUBLIC_DASHBOARD_PERF === '1';
  const start = perfEnabled ? performance.now() : 0;

  const params = new URLSearchParams();

  // Filter params
  if (filters?.search) params.set('search', filters.search);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.token) params.set('token', filters.token);

  // Pagination params
  if (pagination?.page) params.set('page', String(pagination.page));
  if (pagination?.size) params.set('size', String(pagination.size));
  if (pagination?.sortBy) params.set('sortBy', pagination.sortBy);
  if (pagination?.sortDirection) params.set('sortDirection', pagination.sortDirection);

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
      page: pagination?.page,
      size: pagination?.size,
    });
  }

  // Handle both paginated and legacy (array) responses
  if (Array.isArray(json)) {
    // Legacy non-paginated response from old backend
    return {
      data: json,
      total: json.length,
      page: pagination?.page ?? 1,
      size: pagination?.size ?? json.length,
      totalPages: 1,
    };
  }

  return json as PaginatedResponse<AidPackage>;
}

export function useAidPackages(filters?: AidPackageFilters, pagination?: PaginationParams) {
  const search = filters?.search ?? '';
  const status = filters?.status ?? '';
  const token = filters?.token ?? '';
  const page = pagination?.page ?? 1;
  const size = pagination?.size ?? 10;
  const sortBy = pagination?.sortBy ?? '';
  const sortDirection = pagination?.sortDirection ?? '';

  return useQuery({
    queryKey: ['aid-packages', search, status, token, page, size, sortBy, sortDirection],
    queryFn: () => fetchAidPackages({ filters, pagination }),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
