'use client';

import React from 'react';
import { stellarNetwork, envName } from '@/lib/env';

/**
 * Small indicator showing the current Stellar network and optional app environment.
 * Safe to show in production (no secrets); helps contributors and testers avoid confusion.
 */
export const EnvironmentIndicator: React.FC = () => {
  const networkLabel = stellarNetwork.toLowerCase();
  const showEnv = envName && envName.trim() !== '';

  return (
    <div
      className="flex items-center gap-3 text-xs text-gray-400"
      aria-label="Current network and environment"
    >
      <span title="Stellar network">
        Network: <span className="font-medium text-gray-300">{networkLabel}</span>
      </span>
      {showEnv && (
        <>
          <span className="text-gray-500" aria-hidden>
            |
          </span>
          <span title="Application environment">
            Environment: <span className="font-medium text-gray-300">{envName}</span>
          </span>
        </>
      )}
    </div>
  );
};
