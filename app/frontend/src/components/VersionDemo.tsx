'use client';

import React from 'react';
import { useVersion } from '@/hooks/useVersion';
import { useVersionStore } from '@/lib/versionStore';

/**
 * Demo component to test version features
 * This would not be included in production
 */
export function VersionDemo() {
  const {
    currentVersion,
    latestVersion,
    forceUpgradeRequired,
    shouldBlockApp,
    shouldShowNotes,
    releaseNotes,
    loadVersionConfig,
    markReleaseNotesAsSeen,
  } = useVersion();

  const store = useVersionStore();

  const mockConfigs = {
    normal: {
      currentVersion: '1.4.0',
      latestVersion: '1.5.0',
      forceUpgrade: false,
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Feature A', 'Feature B', 'Bug fixes'],
      },
    },
    forceUpgrade: {
      currentVersion: '1.4.0',
      latestVersion: '2.0.0',
      forceUpgrade: true,
      releaseNotes: {
        version: '2.0.0',
        title: "Major Update Required",
        changes: ['Security updates', 'Breaking changes', 'New API'],
      },
    },
    upToDate: {
      currentVersion: '1.5.0',
      latestVersion: '1.5.0',
      forceUpgrade: false,
      releaseNotes: {
        version: '1.5.0',
        title: "What's New",
        changes: ['Feature A', 'Feature B'],
      },
    },
  };

  const handleLoadMock = (config: keyof typeof mockConfigs) => {
    store.setVersionConfig(mockConfigs[config]);
  };

  const handleReset = () => {
    store.setLastSeenVersion(null);
    store.setShouldShowReleaseNotes(false);
  };

  return (
    <div className="p-6 space-y-6 border border-gray-200 dark:border-gray-700 rounded-lg">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Version Features Demo
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Current State */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Current State
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Current Version:</span>
              <code className="font-mono text-gray-900 dark:text-gray-100">
                {currentVersion}
              </code>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Latest Version:</span>
              <code className="font-mono text-gray-900 dark:text-gray-100">
                {latestVersion}
              </code>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Force Upgrade Required:</span>
              <span className={forceUpgradeRequired ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                {forceUpgradeRequired ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Should Block App:</span>
              <span className={shouldBlockApp ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                {shouldBlockApp ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Should Show Notes:</span>
              <span className={shouldShowNotes ? 'text-blue-600 font-medium' : 'text-gray-500'}>
                {shouldShowNotes ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Last Seen Version:</span>
              <code className="font-mono">
                {store.lastSeenVersion || 'None'}
              </code>
            </div>
          </div>
        </div>

        {/* Release Notes Preview */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Release Notes
          </h3>
          {releaseNotes ? (
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div>
                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                  {releaseNotes.title} (v{releaseNotes.version})
                </h4>
              </div>
              <ul className="space-y-2">
                {releaseNotes.changes.map((change, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {change}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">No release notes</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Test Scenarios
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleLoadMock('normal')}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Normal (v1.4.0 → v1.5.0)
          </button>
          <button
            onClick={() => handleLoadMock('forceUpgrade')}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Force Upgrade (v1.4.0 → v2.0.0)
          </button>
          <button
            onClick={() => handleLoadMock('upToDate')}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
          >
            Up to Date (v1.5.0)
          </button>
          <button
            onClick={loadVersionConfig}
            className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            Reload Default
          </button>
          <button
            onClick={markReleaseNotesAsSeen}
            className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            Mark Notes as Seen
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
          >
            Reset Storage
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          How it works:
        </h3>
        <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
          <li>• "Normal": Shows release notes modal (once per version)</li>
          <li>• "Force Upgrade": Blocks app with upgrade screen</li>
          <li>• "Up to Date": No modal, app works normally</li>
          <li>• "Mark as Seen": Stores version locally, hides modal</li>
          <li>• Storage persists across page reloads</li>
        </ul>
      </div>
    </div>
  );
}