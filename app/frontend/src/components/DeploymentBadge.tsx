'use client';

import React, { useState } from 'react';
import { Copy, Check, Globe, ExternalLink } from 'lucide-react';
import { stellarNetwork, contractId, envName } from '@/lib/env';
import { networkLabel, networkBadgeColor, truncateId, buildExplorerUrl } from '@/lib/network-metadata';

/**
 * Compact deployment badge for admin surfaces (dashboard, campaigns, etc.).
 * Displays the active network, contract ID (copyable), and environment.
 */
export function DeploymentBadge() {
  const [copied, setCopied] = useState(false);
  const network = stellarNetwork;
  const cid = contractId;
  const label = networkLabel(network);
  const badgeColor = networkBadgeColor(network);

  const handleCopyContractId = async () => {
    if (!cid) return;
    try {
      await navigator.clipboard.writeText(cid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-2 text-xs" role="status" aria-label="Deployment metadata">
      {/* Network badge */}
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-medium text-white ${badgeColor}`}>
        <Globe size={12} aria-hidden="true" />
        {label}
      </span>

      {/* Contract ID */}
      {cid && (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 font-mono text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
          title={cid}
        >
          <a
            href={buildExplorerUrl('contract', cid)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline inline-flex items-center gap-1"
          >
            {truncateId(cid)}
            <ExternalLink size={10} className="shrink-0 opacity-50" />
          </a>
          <button
            onClick={handleCopyContractId}
            className="inline-flex items-center text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            aria-label={copied ? 'Copied contract ID' : 'Copy contract ID'}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </span>
      )}

      {/* Environment */}
      {envName && (
        <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
          {envName}
        </span>
      )}
    </div>
  );
}
