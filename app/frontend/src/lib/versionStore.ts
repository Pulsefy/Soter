import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VersionConfig, VersionState } from '@/types/version';
import { DEFAULT_VERSION_CONFIG } from '@/lib/defaultVersionConfig';

export const useVersionStore = create<VersionState>()(
  persist(
    (set, get) => ({
      platform: DEFAULT_VERSION_CONFIG.platform,
      currentVersion: DEFAULT_VERSION_CONFIG.currentVersion,
      latestVersion: DEFAULT_VERSION_CONFIG.latestVersion,
      minRequiredVersion: DEFAULT_VERSION_CONFIG.minRequiredVersion ?? null,
      forceUpgradeRequired: DEFAULT_VERSION_CONFIG.forceUpgrade,
      releaseNotes: DEFAULT_VERSION_CONFIG.releaseNotes,
      forceUpgradeScreen: DEFAULT_VERSION_CONFIG.forceUpgradeScreen ?? null,
      storeUrl: DEFAULT_VERSION_CONFIG.storeUrl ?? null,
      lastSeenVersion: null,
      shouldShowReleaseNotes: false,

      setLastSeenVersion: (version: string | null) => {
        set({ lastSeenVersion: version });
      },

      setShouldShowReleaseNotes: (show: boolean) => {
        set({ shouldShowReleaseNotes: show });
      },

      setVersionConfig: (config: VersionConfig) => {
        const { lastSeenVersion } = get();
        const shouldShow =
          !config.forceUpgrade &&
          config.currentVersion !== config.latestVersion &&
          config.releaseNotes?.version !== lastSeenVersion;

        set({
          platform: config.platform,
          currentVersion: config.currentVersion,
          latestVersion: config.latestVersion,
          minRequiredVersion: config.minRequiredVersion ?? null,
          forceUpgradeRequired: config.forceUpgrade,
          releaseNotes: config.releaseNotes,
          forceUpgradeScreen: config.forceUpgradeScreen ?? null,
          storeUrl: config.storeUrl ?? null,
          shouldShowReleaseNotes: shouldShow,
        });
      },
    }),
    {
      name: 'version-storage',
      partialize: (state) => ({
        lastSeenVersion: state.lastSeenVersion,
      }),
    }
  )
);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Service for version data
export class VersionService {
  static async fetchVersionConfig(): Promise<VersionConfig> {
    try {
      const response = await fetch(`${API_URL}/api/v1/config/version?platform=web`);
      if (!response.ok) {
        throw new Error(`Failed to fetch version config: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('Network error fetching version config from backend, falling back to mock:', error);
      return DEFAULT_VERSION_CONFIG;
    }
  }
}
