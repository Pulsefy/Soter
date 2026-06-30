'use client';

import React from 'react';
import { AlertTriangle, Download, RefreshCcw } from 'lucide-react';
import { useVersion } from '@/hooks/useVersion';

interface ForceUpgradeScreenProps {
  onRetry?: () => void;
}

export function ForceUpgradeScreen({ onRetry }: ForceUpgradeScreenProps) {
  const { latestVersion, currentVersion, loadVersionConfig } = useVersion();

  const handleUpdateApp = () => {
    // For MVP: Log to console and open placeholder URL
    console.log('Update App clicked - would redirect to app store');
    window.open('https://soter.app/download', '_blank');
  };

  const handleRetry = async () => {
    if (onRetry) {
      onRetry();
    } else {
      await loadVersionConfig();
    }
  };

  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-slate-950 px-4 py-16 text-slate-100">
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-1/4 h-64 w-64 rounded-full bg-gradient-to-br from-blue-500/20 to-transparent blur-3xl" />
        <div className="absolute right-1/4 bottom-1/4 h-64 w-64 rounded-full bg-gradient-to-tr from-purple-500/20 to-transparent blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        <div className="text-center">
          {/* Icon */}
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-600/20 to-red-600/20 backdrop-blur-sm">
            <AlertTriangle className="h-12 w-12 text-orange-400" aria-hidden="true" />
          </div>

          {/* Title */}
          <h1 className="mb-4 text-3xl font-semibold tracking-tight text-slate-50">
            Upgrade Required
          </h1>

          {/* Description */}
          <p className="mb-8 text-lg text-slate-300">
            A newer version of Soter is required before you can continue using the application.
          </p>

          {/* Version Info */}
          <div className="mb-8 rounded-xl bg-slate-800/50 backdrop-blur-sm p-4 border border-slate-700">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Current Version
                </div>
                <div className="text-xl font-mono text-slate-300">
                  {currentVersion}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Required Version
                </div>
                <div className="text-xl font-mono text-green-400">
                  {latestVersion}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-4">
            <button
              onClick={handleUpdateApp}
              className="w-full flex items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 text-lg font-medium text-white shadow-lg hover:from-blue-700 hover:to-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 transition-all"
            >
              <Download size={20} aria-hidden="true" />
              Update App
            </button>

            <button
              onClick={handleRetry}
              className="w-full flex items-center justify-center gap-3 rounded-xl bg-slate-800/50 backdrop-blur-sm px-6 py-4 text-lg font-medium text-slate-300 hover:bg-slate-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 transition-colors border border-slate-700"
            >
              <RefreshCcw size={20} aria-hidden="true" />
              Check Again
            </button>
          </div>

          {/* Additional Information */}
          <div className="mt-8 space-y-2 text-sm text-slate-400">
            <p>
              This upgrade includes critical security updates and new features required for the platform.
            </p>
            <p className="text-xs">
              For help with the update process, visit our{' '}
              <a
                href="https://soter.app/support"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline transition-colors"
              >
                support page
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}