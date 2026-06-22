'use client';

import React from 'react';
import { useAidPackages } from '@/hooks/useAidPackages';
import type { AidPackage, AidPackageStatus } from '@/types/aid-package';

const STATUS_STYLES: Record<AidPackageStatus, string> = {
  Active: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  Claimed: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  Expired: 'bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400',
};

function PackageCard({ pkg }: { pkg: AidPackage }) {
  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white dark:bg-gray-800 dark:border-gray-700">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-medium">{pkg.title}</h4>
          <p className="text-sm text-gray-500">ID: {pkg.id}</p>
          <p className="text-sm text-gray-500">{pkg.region}</p>
        </div>
        <span className={`px-2 py-1 text-xs rounded-full ${STATUS_STYLES[pkg.status]}`}>
          {pkg.status}
        </span>
      </div>
    </div>
  );
}

export const AidPackageList: React.FC = () => {
  const { data: packages = [], isLoading, error } = useAidPackages();

  if (isLoading) {
    return (
      <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-900 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
        Error loading packages: {error.message}
      </div>
    );
  }

  if (packages.length === 0) {
    return <div className="text-gray-500">No aid packages found.</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Available Aid Packages</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {packages.map(pkg => (
          <PackageCard key={pkg.id} pkg={pkg} />
        ))}
      </div>
    </div>
  );
};
