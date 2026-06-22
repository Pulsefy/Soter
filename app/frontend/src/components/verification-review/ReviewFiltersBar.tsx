'use client';

import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown, X } from 'lucide-react';
import type {
  ReviewFilters,
  VerificationStatus,
  RiskLevel,
} from '@/types/verification-review';

const STATUS_OPTIONS: { value: VerificationStatus; label: string }[] = [
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'needs_resubmission', label: 'Needs Resubmission' },
];

const RISK_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: 'low', label: 'Low Risk' },
  { value: 'medium', label: 'Medium Risk' },
  { value: 'high', label: 'High Risk' },
];

interface FilterSelectProps {
  value: string;
  onValueChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}

function FilterSelect({
  value,
  onValueChange,
  placeholder,
  options,
}: FilterSelectProps) {
  return (
    <SelectPrimitive.Root
      value={value || undefined}
      onValueChange={onValueChange}
    >
      <SelectPrimitive.Trigger className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors min-w-40">
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="ml-auto text-gray-400">
          <ChevronDown size={13} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
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
                className="flex items-center px-3 py-2 rounded-md text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none outline-none data-[highlighted]:bg-gray-50 dark:data-[highlighted]:bg-gray-800 data-[state=checked]:text-blue-600 dark:data-[state=checked]:text-blue-400 data-[state=checked]:font-medium"
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

interface ReviewFiltersBarProps {
  filters: ReviewFilters;
  onChange: (patch: Partial<ReviewFilters>) => void;
}

export function ReviewFiltersBar({ filters, onChange }: ReviewFiltersBarProps) {
  const hasActive =
    filters.status || filters.riskLevel || filters.dateFrom || filters.dateTo;

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <FilterSelect
        value={filters.status}
        onValueChange={v =>
          onChange({
            status: v === '__all__' ? '' : (v as VerificationStatus),
            page: 1,
          })
        }
        placeholder="All Statuses"
        options={STATUS_OPTIONS}
      />

      <FilterSelect
        value={filters.riskLevel}
        onValueChange={v =>
          onChange({
            riskLevel: v === '__all__' ? '' : (v as RiskLevel),
            page: 1,
          })
        }
        placeholder="All Risk Levels"
        options={RISK_OPTIONS}
      />

      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          From
        </label>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => onChange({ dateFrom: e.target.value, page: 1 })}
          className="h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          To
        </label>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => onChange({ dateTo: e.target.value, page: 1 })}
          className="h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors"
        />
      </div>

      {hasActive && (
        <button
          onClick={() =>
            onChange({
              status: '',
              riskLevel: '',
              dateFrom: '',
              dateTo: '',
              page: 1,
            })
          }
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <X size={13} />
          Clear
        </button>
      )}
    </div>
  );
}
