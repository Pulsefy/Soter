'use client';

/**
 * Thin wrapper around the shared useFilterPresetsStore that types the filters
 * as ReviewFilters and fixes the scope to 'verification-review'.
 *
 * Presets are persisted in localStorage via Zustand's persist middleware
 * (same storage key as the dashboard presets, keyed by scope internally).
 */

import { useMemo } from 'react';
import { useFilterPresetsStore } from '@/hooks/useFilterPresets';
import type { ReviewFilters } from '@/types/verification-review';

const SCOPE = 'verification-review' as const;

export function useReviewFilterPresets(currentFilters: ReviewFilters) {
  const { presets, savePreset, deletePreset } = useFilterPresetsStore();

  const scopedPresets = useMemo(
    () => presets.filter(p => p.scope === SCOPE),
    [presets],
  );

  return {
    presets: scopedPresets,
    savePreset: (name: string) =>
      savePreset(name, SCOPE, currentFilters as unknown as import('@/types/aid-package').AidPackageFilters),
    deletePreset,
  };
}
