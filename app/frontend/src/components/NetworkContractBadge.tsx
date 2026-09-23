'use client';

import React, { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { getActiveContractConfig } from '@/lib/contractMetadata';

interface NetworkContractBadgeProps {
  /** Override the contract ID (e.g. from a receipt payload). Falls back to env config. */
  contractId?: string;
  /** Show a compact single-line variant (default: false) */
  compact?: boolean;
  className?: string;
}

/**
 * Displays the active network label and contract ID with a one-click copy button
 * and a stellar.expert explorer link. Works in receipt surfaces and admin views.
 */
export const NetworkContractBadge: React.FC<NetworkContractBadgeProps> = ({
  contractId: contractIdProp,
  compact = false,
  className = '',
}) => {
  const config = getActiveContractConfig();
  const contractId = contractIdProp ?? config.contractId;
  const explorerUrl = contractId
    ? config.explorerUrl?.replace(config.contractId ?? '', contractId) ??
      `https://stellar.expert/explorer/${config.network}/contract/${contractId}`
    : null;

  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!contractId) return;
    try {
      await navigator.clipboard.writeText(contractId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silently ignore
    }
  };

  const networkDot =
    config.network === 'mainnet'
      ? 'bg-emerald-500'
      : config.network === 'futurenet'
        ? 'bg-purple-500'
        : 'bg-yellow-400';

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-mono ${className}`}
        aria-label={`Network: ${config.networkLabel}`}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full shrink-0 ${networkDot}`}
          aria-hidden="true"
        />
        <span className="font-semibold">{config.networkLabel}</span>
        {contractId && (
          <>
            <span className="opacity-50">·</span>
            <span className="opacity-75 truncate max-w-[12ch]">{contractId}</span>
            <button
              onClick={handleCopy}
              aria-label="Copy contract ID"
              title="Copy contract ID"
              className="opacity-60 hover:opacity-100 transition-opacity"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </>
        )}
      </span>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-current/10 bg-black/5 dark:bg-white/5 px-4 py-3 ${className}`}
    >
      {/* Network label */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${networkDot}`}
            aria-hidden="true"
          />
          <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
            Network
          </span>
        </div>
        <p className="text-sm font-semibold">{config.networkLabel}</p>
      </div>

      {/* Contract ID */}
      {contractId ? (
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">
            Contract ID
          </p>
          <div className="flex items-center gap-1.5 min-w-0">
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all text-blue-600 hover:underline dark:text-blue-400 flex items-center gap-1 min-w-0"
                aria-label={`View contract ${contractId} on Stellar Expert`}
              >
                <span className="truncate">{contractId}</span>
                <ExternalLink size={11} className="shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <span className="font-mono text-xs break-all opacity-80">{contractId}</span>
            )}
            <button
              onClick={handleCopy}
              aria-label="Copy contract ID"
              title="Copy contract ID"
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              {copied ? (
                <Check size={13} className="text-green-600 dark:text-green-400" />
              ) : (
                <Copy size={13} />
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">
            Contract ID
          </p>
          <p className="text-xs opacity-50 italic">Not configured</p>
        </div>
      )}
    </div>
  );
};
