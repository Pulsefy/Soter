/**
 * Unit tests for the useFilterPresets Zustand store.
 *
 * We test the raw store (useFilterPresetsStore) directly so that we don't need
 * to render components or mock Next.js router in these tests.
 */

import { act } from 'react';
import { useFilterPresetsStore } from '../useFilterPresets';
import type { AidPackageFilters } from '@/types/aid-package';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Reset the Zustand store to its initial state between tests. */
function resetStore() {
  act(() => {
    useFilterPresetsStore.setState({ presets: [] });
  });
}

const dashboardFilters: AidPackageFilters = { search: 'relief', status: 'Active', token: 'USDC' };
const campaignFilters: AidPackageFilters = { status: 'Active' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useFilterPresetsStore', () => {
  beforeEach(resetStore);

  // ── savePreset ─────────────────────────────────────────────────────────────

  describe('savePreset', () => {
    it('adds a new preset with the correct fields', () => {
      act(() => {
        useFilterPresetsStore.getState().savePreset('Active USDC', 'dashboard', dashboardFilters);
      });

      const { presets } = useFilterPresetsStore.getState();
      expect(presets).toHaveLength(1);
      expect(presets[0].name).toBe('Active USDC');
      expect(presets[0].scope).toBe('dashboard');
      expect(presets[0].filters).toEqual(dashboardFilters);
      expect(typeof presets[0].id).toBe('string');
      expect(typeof presets[0].createdAt).toBe('number');
    });

    it('returns the saved preset', () => {
      let returned: ReturnType<typeof useFilterPresetsStore.getState>['savePreset'] extends (
        ...args: Parameters<typeof useFilterPresetsStore.getState>['savePreset']
      ) => infer R
        ? R
        : never;

      act(() => {
        returned = useFilterPresetsStore
          .getState()
          .savePreset('My Preset', 'dashboard', dashboardFilters);
      });

      expect(returned!.name).toBe('My Preset');
      expect(returned!.scope).toBe('dashboard');
    });

    it('overwrites an existing preset with the same name+scope (case-insensitive)', () => {
      act(() => {
        useFilterPresetsStore.getState().savePreset('Relief View', 'dashboard', dashboardFilters);
      });

      const idBefore = useFilterPresetsStore.getState().presets[0].id;

      const updated: AidPackageFilters = { status: 'Claimed', token: 'XLM' };
      act(() => {
        useFilterPresetsStore.getState().savePreset('relief view', 'dashboard', updated);
      });

      const { presets } = useFilterPresetsStore.getState();
      expect(presets).toHaveLength(1); // No duplicate
      expect(presets[0].id).toBe(idBefore); // Same ID preserved
      expect(presets[0].filters).toEqual(updated); // Updated filters
    });

    it('does NOT overwrite when name matches but scope differs', () => {
      act(() => {
        useFilterPresetsStore.getState().savePreset('My View', 'dashboard', dashboardFilters);
        useFilterPresetsStore.getState().savePreset('My View', 'campaigns', campaignFilters);
      });

      const { presets } = useFilterPresetsStore.getState();
      expect(presets).toHaveLength(2);
    });

    it('accumulates multiple distinct presets', () => {
      act(() => {
        useFilterPresetsStore.getState().savePreset('A', 'dashboard', { status: 'Active' });
        useFilterPresetsStore.getState().savePreset('B', 'dashboard', { status: 'Claimed' });
        useFilterPresetsStore.getState().savePreset('C', 'dashboard', { token: 'XLM' });
      });

      expect(useFilterPresetsStore.getState().presets).toHaveLength(3);
    });
  });

  // ── deletePreset ──────────────────────────────────────────────────────────

  describe('deletePreset', () => {
    it('removes the preset with the given ID', () => {
      let id = '';
      act(() => {
        const p = useFilterPresetsStore
          .getState()
          .savePreset('To Delete', 'dashboard', dashboardFilters);
        id = p.id;
      });

      act(() => {
        useFilterPresetsStore.getState().deletePreset(id);
      });

      const { presets } = useFilterPresetsStore.getState();
      expect(presets).toHaveLength(0);
    });

    it('does not remove other presets', () => {
      let idA = '';
      act(() => {
        idA = useFilterPresetsStore
          .getState()
          .savePreset('A', 'dashboard', { status: 'Active' }).id;
        useFilterPresetsStore.getState().savePreset('B', 'dashboard', { status: 'Claimed' });
      });

      act(() => {
        useFilterPresetsStore.getState().deletePreset(idA);
      });

      const { presets } = useFilterPresetsStore.getState();
      expect(presets).toHaveLength(1);
      expect(presets[0].name).toBe('B');
    });

    it('is a no-op for a non-existent ID', () => {
      act(() => {
        useFilterPresetsStore.getState().savePreset('X', 'dashboard', {});
      });

      act(() => {
        useFilterPresetsStore.getState().deletePreset('does-not-exist');
      });

      expect(useFilterPresetsStore.getState().presets).toHaveLength(1);
    });
  });

  // ── getPresets ─────────────────────────────────────────────────────────────

  describe('getPresets', () => {
    it('returns only presets matching the given scope', () => {
      act(() => {
        useFilterPresetsStore.getState().savePreset('D1', 'dashboard', dashboardFilters);
        useFilterPresetsStore.getState().savePreset('D2', 'dashboard', { token: 'XLM' });
        useFilterPresetsStore.getState().savePreset('C1', 'campaigns', campaignFilters);
      });

      const dashboardOnly = useFilterPresetsStore.getState().getPresets('dashboard');
      const campaignsOnly = useFilterPresetsStore.getState().getPresets('campaigns');

      expect(dashboardOnly).toHaveLength(2);
      expect(dashboardOnly.every(p => p.scope === 'dashboard')).toBe(true);

      expect(campaignsOnly).toHaveLength(1);
      expect(campaignsOnly[0].name).toBe('C1');
    });

    it('returns an empty array when no presets exist for a scope', () => {
      act(() => {
        useFilterPresetsStore.getState().savePreset('D1', 'dashboard', dashboardFilters);
      });

      expect(useFilterPresetsStore.getState().getPresets('campaigns')).toHaveLength(0);
    });
  });
});
