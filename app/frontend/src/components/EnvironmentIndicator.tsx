'use client';

import React, { useState } from 'react';
import { Copy, Check, Globe } from 'lucide-react';
import { stellarNetwork, envName, contractId } from '@/lib/env';
import { networkLabel, truncateId } from '@/lib/network-metadata';

/**
 * Small indicator showing the current Stellar network and optional app environment.
 * Safe to show in production (no secrets); helps contributors and testers avoid confusion.
 */
export const EnvironmentIndicator: React.FC = () => {
  const label = networkLabel(stellarNetwork);
  const showEnv = envName && envName.trim() !== '';
  const [copied, setCopied] = useState(false);

  const handleCopyContractId = async () => {
    if (!contractId) return;
    try {
      await navigator.clipboard.writeText(contractId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div
      className="flex items-center gap-3 text-xs text-gray-400"
      aria-label="Current network and environment"
    >
      <span title="Stellar network" className="inline-flex items-center gap-1">
        <Globe size={12} className="opacity-60" />
        <span className="font-medium text-gray-300">{label}</span>
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
      {contractId && (
        <>
          <span className="text-gray-500" aria-hidden>
            |
          </span>
          <span title={`Contract: ${contractId}`} className="inline-flex items-center gap-1">
            <span className="font-mono text-gray-300">{truncateId(contractId)}</span>
            <button
              onClick={handleCopyContractId}
              className="inline-flex items-center text-gray-400 hover:text-gray-200 transition-colors"
              aria-label={copied ? 'Copied contract ID' : 'Copy contract ID'}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </span>
        </>
      )}
    </div>
  );
};
