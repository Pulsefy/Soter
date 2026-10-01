'use client';

import React, { useEffect, useState } from 'react';
import { useVersion } from '@/hooks/useVersion';
import { useVersionStore } from '@/lib/versionStore';
import { ReleaseNotesModal } from '@/components/ReleaseNotesModal';
import { ForceUpgradeScreen } from '@/components/ForceUpgradeScreen';

interface VersionProviderProps {
  children: React.ReactNode;
}

export function VersionProvider({ children }: VersionProviderProps) {
  const {
    shouldBlockApp,
    loadVersionConfig,
    isLoading,
  } = useVersion();
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Load version config on mount. The modal is opened from the async
  // continuation after the fetch resolves (not synchronously in the effect
  // body), so mounting cannot cascade renders.
  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      await loadVersionConfig();
      if (cancelled) return;
      const { shouldShowReleaseNotes, forceUpgradeRequired } =
        useVersionStore.getState();
      if (shouldShowReleaseNotes && !forceUpgradeRequired) {
        setNotesModalOpen(true);
      }
      setInitialized(true);
    };
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [loadVersionConfig]);

  if (isLoading || !initialized) {
    // Show loading state or nothing while checking version
    return null;
  }

  // Force upgrade takes priority
  if (shouldBlockApp) {
    return <ForceUpgradeScreen />;
  }

  return (
    <>
      {children}
      <ReleaseNotesModal
        open={notesModalOpen}
        onOpenChange={setNotesModalOpen}
      />
    </>
  );
}