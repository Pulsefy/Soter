'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DashboardFilters } from './DashboardFilters';
import { FilteredPackageList } from './FilteredPackageList';
import { FilterPresets } from './FilterPresets';
import { ExportControls } from './ExportControls';
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  /**
   * Apply a preset (or restore defaults) by rebuilding the URL from scratch.
   * This avoids stale params lingering from the previous filter state.
   */
  const handleApplyPreset = useCallback(
    (preset: AidPackageFilters) => {
      const params = new URLSearchParams();
      if (preset.search) params.set('search', preset.search);
      if (preset.status) params.set('status', preset.status);
      if (preset.token) params.set('token', preset.token);
      // Also update the local search field immediately
      setLocalSearch(preset.search ?? '');
      router.replace(params.size ? `?${params.toString()}` : '?', { scroll: false });
    },
    [router],
  );

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
        <ExportControls context="Aid Packages" filters={filters} />
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

      {/* Preset bar — save/apply/delete/copy/restore */}
      <FilterPresets
        filters={filters}
        scope="dashboard"
        onApply={handleApplyPreset}
      />

      {/* Package list */}
      <FilteredPackageList filters={filters} />
    </div>
  );
}
