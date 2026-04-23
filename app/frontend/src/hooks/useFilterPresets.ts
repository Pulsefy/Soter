'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { FilterPreset, AidPackageFilters, FilterScope } from '@/types/aid-package';

const STORAGE_KEY = 'soter-filter-presets';

function generateId(): string {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface FilterPresetsState {
  presets: FilterPreset[];

  /** Save a named preset. Overwrites any existing preset with the same name+scope. */
  savePreset: (name: string, scope: FilterScope, filters: AidPackageFilters) => FilterPreset;

  /** Delete a preset by ID. */
  deletePreset: (id: string) => void;

  /** Return only presets matching the given scope. */
  getPresets: (scope: FilterScope) => FilterPreset[];
}

export const useFilterPresetsStore = create<FilterPresetsState>()(
  persist(
    (set, get) => ({
      presets: [],

      savePreset(name, scope, filters) {
        const trimmedName = name.trim();

        // Overwrite if a preset with the exact same name+scope already exists
        const existing = get().presets.find(
          p => p.scope === scope && p.name.toLowerCase() === trimmedName.toLowerCase(),
        );

        const preset: FilterPreset = {
          id: existing?.id ?? generateId(),
          name: trimmedName,
          scope,
          filters,
          createdAt: existing?.createdAt ?? Date.now(),
        };

        set(state => ({
          presets: existing
            ? state.presets.map(p => (p.id === existing.id ? preset : p))
            : [...state.presets, preset],
        }));

        return preset;
      },

      deletePreset(id) {
        set(state => ({ presets: state.presets.filter(p => p.id !== id) }));
      },

      getPresets(scope) {
        return get().presets.filter(p => p.scope === scope);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => {
        // Guard against SSR where localStorage is unavailable
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
    },
  ),
);

/**
 * Convenience hook — returns helpers scoped to a specific list.
 * Components should use this rather than the raw store.
 */
export function useFilterPresets(scope: FilterScope) {
  const { presets, savePreset, deletePreset } = useFilterPresetsStore();

  const scopedPresets = presets.filter(p => p.scope === scope);

  return {
    presets: scopedPresets,
    savePreset: (name: string, filters: AidPackageFilters) => savePreset(name, scope, filters),
    deletePreset,
  };
}
