'use client';

import { useEffect, useState } from 'react';
import { useVersionStore, VersionService } from '@/lib/versionStore';
import type { VersionConfig } from '@/types/version';

export function useVersion() {
  const store = useVersionStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVersionConfig = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const config = await VersionService.fetchVersionConfig();
      store.setVersionConfig(config);
    } catch (err) {
      setError('Failed to load version information');
      console.error('Version config load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

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
    currentVersion: store.currentVersion,
    latestVersion: store.latestVersion,
    forceUpgradeRequired: store.forceUpgradeRequired,
    releaseNotes: store.releaseNotes,
    shouldBlockApp,
    shouldShowNotes,
    loadVersionConfig,
    handleContinue,
    markReleaseNotesAsSeen,
  };
}