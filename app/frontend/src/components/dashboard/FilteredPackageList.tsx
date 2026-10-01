'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useAidPackages } from '@/hooks/useAidPackages';
import { Pagination } from '@/components/Pagination';
import { AppEmptyState } from '@/components/empty-state/AppEmptyState';
import { getAppUserRole, isOperationsRole } from '@/lib/app-role';
import type { AidPackage, AidPackageFilters, AidPackageStatus } from '@/types/aid-package';

const STATUS_STYLES: Record<AidPackageStatus, string> = {
  Active:
    'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  Claimed:
    'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800',
  Expired:
    'bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700',
};

const TABLE_HEADERS = ['ID', 'Title', 'Region', 'Amount', 'Recipients', 'Status', 'Token'];

const StatusBadge = React.memo(function StatusBadge({ status }: { status: AidPackageStatus }) {
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
});

const SkeletonRow = React.memo(function SkeletonRow() {
  return (
    <tr>
      {TABLE_HEADERS.map(h => (
        <td key={h} className="py-4 pr-6">
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
});

const PackageCard = React.memo(function PackageCard({ pkg }: { pkg: AidPackage }) {
  return (
    <div className="p-4 rounded-lg border border-gray-100 dark:border-gray-800 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-sm leading-snug">{pkg.title}</p>
        <StatusBadge status={pkg.status} />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{pkg.region}</p>
      <div className="flex gap-4 text-sm flex-wrap">
        <span className="font-semibold">{pkg.amount}</span>
        <span className="text-gray-500">{pkg.recipients} recipients</span>
        <span className="text-xs font-mono text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          {pkg.token}
        </span>
      </div>
      <p className="text-xs font-mono text-gray-400">{pkg.id}</p>
    </div>
  );
});

interface FilteredPackageListProps {
  filters: AidPackageFilters;
  page?: number;
  size?: number;
  onPageChange?: (page: number) => void;
}

export const FilteredPackageList = React.memo(function FilteredPackageList({ filters, page = 1, size = 10, onPageChange }: FilteredPackageListProps) {
  const t = useTranslations();
  const { data: response, isLoading, error } = useAidPackages(filters, { page, size });
  const packages = response?.data ?? [];
  const totalItems = response?.total ?? 0;
  const totalPages = response?.totalPages ?? 1;
  const role = getAppUserRole();
  const hasFilters = Boolean(filters.search || filters.status || filters.token);

  if (error) {
    return (
      <div
        data-testid="packages-error"
        className="p-4 border border-red-200 rounded-lg bg-red-50 dark:bg-red-950/30 dark:border-red-900 text-red-700 dark:text-red-400 text-sm"
      >
        Error loading packages: {error.message}
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div
        className="hidden md:block overflow-x-auto"
        data-testid={isLoading ? 'packages-loading' : undefined}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
              {TABLE_HEADERS.map(h => (
                <th
                  key={h}
                  className="pb-3 pr-6 font-medium text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : packages && packages.length > 0 ? (
              packages.map(pkg => (
                <tr
                  key={pkg.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                >
                  <td className="py-4 pr-6 font-mono text-xs text-gray-400">{pkg.id}</td>
                  <td className="py-4 pr-6 font-medium">{pkg.title}</td>
                  <td className="py-4 pr-6 text-gray-600 dark:text-gray-400">{pkg.region}</td>
                  <td className="py-4 pr-6 font-semibold">{pkg.amount}</td>
                  <td className="py-4 pr-6 text-gray-600 dark:text-gray-400">{pkg.recipients}</td>
                  <td className="py-4 pr-6">
                    <StatusBadge status={pkg.status} />
                  </td>
                  <td className="py-4">
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {pkg.token}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={TABLE_HEADERS.length} className="py-12 text-center">
                  <div className="mx-auto max-w-3xl text-left" data-testid="packages-empty-state">
                    <AppEmptyState
                      compact
                      eyebrow={
                        hasFilters
                          ? t('emptyStates.dashboard.noMatches.eyebrow')
                          : t('emptyStates.dashboard.noPackages.eyebrow')
                      }
                      title={
                        hasFilters
                          ? t('emptyStates.dashboard.noMatches.title')
                          : isOperationsRole(role)
                            ? t('emptyStates.dashboard.noPackages.operatorTitle')
                            : t('emptyStates.dashboard.noPackages.viewerTitle')
                      }
                      description={
                        hasFilters
                          ? t('emptyStates.dashboard.noMatches.description')
                          : isOperationsRole(role)
                            ? t('emptyStates.dashboard.noPackages.operatorDescription')
                            : t('emptyStates.dashboard.noPackages.viewerDescription')
                      }
                      actions={
                        hasFilters
                          ? [
                              {
                                href: '/dashboard',
                                label: t('emptyStates.dashboard.noMatches.resetAction'),
                                icon: 'next',
                              },
                              {
                                href: '/help',
                                label: t('emptyStates.dashboard.noMatches.secondaryAction'),
                                icon: 'docs',
                                variant: 'secondary',
                              },
                            ]
                          : isOperationsRole(role)
                            ? [
                                {
                                  href: '/campaigns',
                                  label: t('emptyStates.dashboard.noPackages.operatorAction'),
                                  icon: 'next',
                                },
                                {
                                  href: '/help',
                                  label: t('emptyStates.dashboard.noPackages.secondaryAction'),
                                  icon: 'docs',
                                  variant: 'secondary',
                                },
                              ]
                            : [
                                {
                                  href: '/',
                                  label: t('emptyStates.dashboard.noPackages.viewerAction'),
                                  icon: 'next',
                                },
                                {
                                  href: '/help',
                                  label: t('emptyStates.dashboard.noPackages.secondaryAction'),
                                  icon: 'docs',
                                  variant: 'secondary',
                                },
                              ]
                      }
                    />
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <>
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="p-4 rounded-lg border border-gray-100 dark:border-gray-800 space-y-2 animate-pulse"
              >
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
                <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/3" />
              </div>
            ))}
          </>
        ) : packages && packages.length > 0 ? (
          packages.map(pkg => <PackageCard key={pkg.id} pkg={pkg} />)
        ) : (
          <div data-testid="packages-empty-state-mobile">
            <AppEmptyState
              compact
              eyebrow={
                hasFilters
                  ? t('emptyStates.dashboard.noMatches.eyebrow')
                  : t('emptyStates.dashboard.noPackages.eyebrow')
              }
              title={
                hasFilters
                  ? t('emptyStates.dashboard.noMatches.title')
                  : isOperationsRole(role)
                    ? t('emptyStates.dashboard.noPackages.operatorTitle')
                    : t('emptyStates.dashboard.noPackages.viewerTitle')
              }
              description={
                hasFilters
                  ? t('emptyStates.dashboard.noMatches.description')
                  : isOperationsRole(role)
                    ? t('emptyStates.dashboard.noPackages.operatorDescription')
                    : t('emptyStates.dashboard.noPackages.viewerDescription')
              }
              actions={
                isOperationsRole(role)
                  ? [
                      {
                        href: '/campaigns',
                        label: t('emptyStates.dashboard.noPackages.operatorAction'),
                        icon: 'next',
                      },
                      {
                        href: '/help',
                        label: t('emptyStates.dashboard.noPackages.secondaryAction'),
                        icon: 'docs',
                        variant: 'secondary',
                      },
                    ]
                  : [
                      {
                        href: '/',
                        label: t('emptyStates.dashboard.noPackages.viewerAction'),
                        icon: 'next',
                      },
                      {
                        href: '/help',
                        label: t('emptyStates.dashboard.noPackages.secondaryAction'),
                        icon: 'docs',
                        variant: 'secondary',
                      },
                    ]
              }
            />
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && totalItems > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={size}
          totalItems={totalItems}
          onPageChange={onPageChange ?? (() => {})}
        />
      )}
    </>
  );
});
