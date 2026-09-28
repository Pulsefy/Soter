'use client';

import { useCallback, useState } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useVersionStore, VersionService } from '@/lib/versionStore';

export function useVersion() {
  const store = useVersionStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable identity: consumers (e.g. VersionProvider) run this inside an effect
  // keyed on the function, so a new reference each render would loop forever.
  const loadVersionConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const config = await VersionService.fetchVersionConfig();
      useVersionStore.getState().setVersionConfig(config);
    } catch (err) {
      setError('Failed to load version information');
      console.error('Version config load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);
  }, [store.setVersionConfig]);

  const handleContinue = () => {
    if (store.releaseNotes) {
      store.setLastSeenVersion(store.releaseNotes.version);
      store.setShouldShowReleaseNotes(false);
    }
  };

  const markReleaseNotesAsSeen = () => {
    if (store.releaseNotes) {
      store.setLastSeenVersion(store.releaseNotes.version);
      store.setShouldShowReleaseNotes(false);
    }
  };

  const shouldBlockApp = store.forceUpgradeRequired;
  const shouldShowNotes = store.shouldShowReleaseNotes && !store.forceUpgradeRequired;

  return {
    isLoading,
    error,
    platform: store.platform,
    currentVersion: store.currentVersion,
    latestVersion: store.latestVersion,
    minRequiredVersion: store.minRequiredVersion,
    forceUpgradeRequired: store.forceUpgradeRequired,
    releaseNotes: store.releaseNotes,
    forceUpgradeScreen: store.forceUpgradeScreen,
    storeUrl: store.storeUrl,
    shouldBlockApp,
    shouldShowNotes,
    loadVersionConfig,
    handleContinue,
    markReleaseNotesAsSeen,
  };
}
