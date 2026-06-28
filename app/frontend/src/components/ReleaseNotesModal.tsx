'use client';

import React, { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, CheckCircle, ExternalLink } from 'lucide-react';
import { useVersion } from '@/hooks/useVersion';
import { useTranslations } from 'next-intl';

interface ReleaseNotesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReleaseNotesModal({ open, onOpenChange }: ReleaseNotesModalProps) {
  const t = useTranslations();
  const { releaseNotes, handleContinue, shouldShowNotes } = useVersion();

  // Close modal if notes shouldn't be shown
  useEffect(() => {
    if (!shouldShowNotes && open) {
      onOpenChange(false);
    }
  }, [shouldShowNotes, open, onOpenChange]);

  const handleContinueClick = () => {
    handleContinue();
    onOpenChange(false);
  };

  if (!releaseNotes) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 focus:outline-none"
          aria-describedby="release-notes-description"
        >
          <div className="flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="p-6 pb-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <Dialog.Title className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {releaseNotes.title}
                  </Dialog.Title>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Version {releaseNotes.version}
                  </p>
                </div>
                <Dialog.Close
                  aria-label="Close dialog"
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                  <X size={20} aria-hidden="true" />
                </Dialog.Close>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div id="release-notes-description" className="sr-only">
                Release notes for version {releaseNotes.version}
              </div>
              
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                    <CheckCircle size={18} aria-hidden="true" />
                    <p className="text-sm font-medium">
                      Update available! We recommend installing the latest version for the best experience.
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    What's new in this version
                  </h3>
                  <ul className="space-y-3">
                    {releaseNotes.changes.map((change, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 flex-shrink-0" />
                        <span className="text-sm text-gray-600 dark:text-gray-300">
                          {change}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-4 mt-4">
                  <p>
                    You can continue using the current version. The update is optional but recommended.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 pt-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => window.open('https://soter.app/changelog', '_blank')}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  View full changelog
                </button>
                <button
                  onClick={handleContinueClick}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  autoFocus
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}