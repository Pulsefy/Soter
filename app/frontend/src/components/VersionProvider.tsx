'use client';

import React, { useEffect, useState } from 'react';
import { useVersion } from '@/hooks/useVersion';
import { ReleaseNotesModal } from '@/components/ReleaseNotesModal';
import { ForceUpgradeScreen } from '@/components/ForceUpgradeScreen';

interface VersionProviderProps {
  children: React.ReactNode;
}

export function VersionProvider({ children }: VersionProviderProps) {
  const {
    shouldBlockApp,
    shouldShowNotes,
    loadVersionConfig,
    isLoading,
  } = useVersion();
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Load version config on mount
  useEffect(() => {
    const initialize = async () => {
      await loadVersionConfig();
      setInitialized(true);
    };
    initialize();
  }, [loadVersionConfig]);

  // Show release notes modal when appropriate
  useEffect(() => {
    if (initialized && shouldShowNotes && !isLoading) {
      setNotesModalOpen(true);
    }
  }, [initialized, shouldShowNotes, isLoading]);

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