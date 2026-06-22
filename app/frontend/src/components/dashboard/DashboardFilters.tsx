'use client';

import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Search, ChevronDown, X } from 'lucide-react';
import type { AidPackageStatus, TokenType } from '@/types/aid-package';

const STATUS_OPTIONS: { value: AidPackageStatus; label: string }[] = [
  { value: 'Active', label: 'Active' },
  { value: 'Claimed', label: 'Claimed' },
  { value: 'Expired', label: 'Expired' },
];

const TOKEN_OPTIONS: { value: TokenType; label: string }[] = [
  { value: 'USDC', label: 'USDC' },
  { value: 'XLM', label: 'XLM' },
  { value: 'EURC', label: 'EURC' },
];

interface FilterSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}

function FilterSelect({ value, onValueChange, placeholder, options }: FilterSelectProps) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger className="flex items-center gap-2 h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-400 transition-colors min-w-36 data-[state=open]:border-blue-500 data-[state=open]:ring-2 data-[state=open]:ring-blue-500/30">
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="ml-auto text-gray-400">
          <ChevronDown size={14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {/* "All" option to clear the filter */}
            <SelectPrimitive.Item
              value="__all__"
              className="flex items-center px-3 py-2 rounded-md text-sm text-gray-500 dark:text-gray-400 cursor-pointer select-none outline-none data-[highlighted]:bg-gray-50 dark:data-[highlighted]:bg-gray-800 italic"
            >
              <SelectPrimitive.ItemText>{placeholder}</SelectPrimitive.ItemText>
            </SelectPrimitive.Item>

            <SelectPrimitive.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-800" />

            {options.map(opt => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none outline-none data-[highlighted]:bg-gray-50 dark:data-[highlighted]:bg-gray-800 data-[state=checked]:text-blue-600 dark:data-[state=checked]:text-blue-400 data-[state=checked]:font-medium"
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

interface DashboardFiltersProps {
  search: string;
  status: string;
  token: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onTokenChange: (value: string) => void;
}

export function DashboardFilters({
  search,
  status,
  token,
  onSearchChange,
  onStatusChange,
  onTokenChange,
}: DashboardFiltersProps) {
  const hasActiveFilters = search || status || token;

  function handleStatusChange(value: string) {
    onStatusChange(value === '__all__' ? '' : value);
  }

  function handleTokenChange(value: string) {
    onTokenChange(value === '__all__' ? '' : value);
  }

  function clearAll() {
    onSearchChange('');
    onStatusChange('');
    onTokenChange('');
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
      {/* Search input */}
      <div className="relative flex-1">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search by ID, title, or region…"
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
        />
      </div>

      {/* Status filter */}
      <FilterSelect
        value={status}
        onValueChange={handleStatusChange}
        placeholder="All Statuses"
        options={STATUS_OPTIONS}
      />

      {/* Token filter */}
      <FilterSelect
        value={token}
        onValueChange={handleTokenChange}
        placeholder="All Tokens"
        options={TOKEN_OPTIONS}
      />

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1.5 h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200 transition-colors whitespace-nowrap"
          aria-label="Clear all filters"
        >
          <X size={13} />
          Clear
        </button>
      )}
    </div>
  );
}
