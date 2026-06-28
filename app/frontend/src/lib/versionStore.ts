import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VersionConfig, VersionState } from '@/types/version';

const MOCK_VERSION_CONFIG: VersionConfig = {
  currentVersion: '1.4.0',
  latestVersion: '1.5.0',
  forceUpgrade: false,
  releaseNotes: {
    version: '1.5.0',
    title: "What's New",
    changes: [
      'Improved beneficiary verification',
      'Faster voucher loading',
      'Offline sync improvements',
      'Enhanced security measures',
    ],
  },
};

export const useVersionStore = create<VersionState>()(
  persist(
    (set, get) => ({
      currentVersion: MOCK_VERSION_CONFIG.currentVersion,
      latestVersion: MOCK_VERSION_CONFIG.latestVersion,
      forceUpgradeRequired: MOCK_VERSION_CONFIG.forceUpgrade,
      releaseNotes: MOCK_VERSION_CONFIG.releaseNotes,
      lastSeenVersion: null,
      shouldShowReleaseNotes: false,

      setLastSeenVersion: (version: string) => {
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
          currentVersion: config.currentVersion,
          latestVersion: config.latestVersion,
          forceUpgradeRequired: config.forceUpgrade,
          releaseNotes: config.releaseNotes,
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

// Mock service for version data
export class VersionService {
  static async fetchVersionConfig(): Promise<VersionConfig> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    // In the future, this would make an API call:
    // const response = await fetch('/api/app/version');
    // return response.json();
    
    return MOCK_VERSION_CONFIG;
  }
}