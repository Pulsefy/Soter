'use client';

import React, { useCallback, useState } from 'react';
import { useAidPackages } from '@/hooks/useAidPackages';
import { Pagination } from '@/components/Pagination';
import type { AidPackage, AidPackageStatus } from '@/types/aid-package';

const PAGE_SIZE = 10;

const STATUS_STYLES: Record<AidPackageStatus, string> = {
  Active: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  Claimed: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  Expired: 'bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400',
};

function PackageCard({ pkg }: { pkg: AidPackage }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-medium text-gray-900 dark:text-gray-100">{pkg.title}</h4>
          <p className="text-sm text-gray-500 dark:text-gray-400">ID: {pkg.id}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{pkg.region}</p>
        </div>
        <span className={`px-2 py-1 text-xs rounded-full ${STATUS_STYLES[pkg.status]}`}>
          {pkg.status}
        </span>
      </div>
    </div>
  );
}

export const AidPackageList: React.FC = () => {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'id' | 'title' | 'status' | 'amount'>('id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const { data: response, isLoading, isFetching, error } = useAidPackages(undefined, {
    page,
    size: PAGE_SIZE,
    sortBy,
    sortDirection,
  });

  const packages = response?.data ?? [];
  const totalItems = response?.total ?? 0;
  const totalPages = response?.totalPages ?? 1;

  const handlePageChange = useCallback((next: number) => {
    setPage(next);
  }, []);

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-2 h-4 w-1/3 rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        Error loading packages: {error.message}
      </div>
    );
  }

  if (totalItems === 0) {
    return <div className="text-gray-500 dark:text-gray-400">No aid packages found.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Available Aid Packages
        </h3>
        <label className="text-sm text-gray-600 dark:text-gray-400">
          Sort{' '}
          <select
            value={`${sortBy}:${sortDirection}`}
            onChange={e => {
              const [nextSort, nextDir] = e.target.value.split(':') as [
                typeof sortBy,
                typeof sortDirection,
              ];
              setSortBy(nextSort);
              setSortDirection(nextDir);
              setPage(1);
            }}
            className="rounded border border-gray-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="id:asc">ID ↑</option>
            <option value="id:desc">ID ↓</option>
            <option value="title:asc">Title ↑</option>
            <option value="title:desc">Title ↓</option>
            <option value="status:asc">Status ↑</option>
            <option value="status:desc">Status ↓</option>
            <option value="amount:asc">Amount ↑</option>
            <option value="amount:desc">Amount ↓</option>
          </select>
        </label>
      </div>
      <div className={`grid gap-4 md:grid-cols-2 ${isFetching ? 'opacity-70' : ''}`}>
        {packages.map(pkg => (
          <PackageCard key={pkg.id} pkg={pkg} />
        ))}
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        totalItems={totalItems}
        onPageChange={handlePageChange}
      />
    </div>
  );
};
