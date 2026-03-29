'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DashboardFilters } from './DashboardFilters';
import { FilteredPackageList } from './FilteredPackageList';
import type { AidPackageFilters } from '@/types/aid-package';

export function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const urlSearch = searchParams.get('search') ?? '';
  const urlStatus = searchParams.get('status') ?? '';
  const urlToken = searchParams.get('token') ?? '';

  // Local state for immediate input responsiveness
  const [localSearch, setLocalSearch] = useState(urlSearch);

  // Sync localSearch if URL changes externally (e.g. browser back/forward)
  useEffect(() => {
    setLocalSearch(urlSearch);
  }, [urlSearch]);

  // Debounce search → URL
  useEffect(() => {
    const timer = setTimeout(() => {
      updateParam('search', localSearch);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function handleSearchChange(value: string) {
    setLocalSearch(value);
  }

  function handleStatusChange(value: string) {
    updateParam('status', value);
  }

  function handleTokenChange(value: string) {
    updateParam('token', value);
  }

  const filters: AidPackageFilters = {
    search: urlSearch,
    status: urlStatus as AidPackageFilters['status'],
    token: urlToken as AidPackageFilters['token'],
  };

  return (
    <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Aid Packages</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500 italic">
          Placeholder — live data in a future wave
        </span>
      </div>

      {/* Filters */}
      <DashboardFilters
        search={localSearch}
        status={urlStatus}
        token={urlToken}
        onSearchChange={handleSearchChange}
        onStatusChange={handleStatusChange}
        onTokenChange={handleTokenChange}
      />

      {/* Package list */}
      <FilteredPackageList filters={filters} />
    </div>
  );
}
