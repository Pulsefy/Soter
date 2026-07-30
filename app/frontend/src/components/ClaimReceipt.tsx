'use client';

import React, { useMemo } from 'react';
import { Share2, Download, Copy, Check, ExternalLink } from 'lucide-react';
import { useTheme } from 'next-themes';
import { format } from 'date-fns';
import { buildExplorerUrl } from '../lib/explorer';

export interface ClaimReceiptData {
  claimId: string;
  packageId: string;
  status:
    | 'requested'
    | 'verified'
    | 'approved'
    | 'disbursed'
    | 'archived'
    | 'cancelled';
  amount: number;
  tokenAddress?: string;
  transactionHash?: string;
  contractAddress?: string;
  timestamp: string;
  recipientRef?: string;
  explorerLink?: string;
}

interface ClaimReceiptProps {
  claim: ClaimReceiptData;
  onShare?: () => Promise<void>;
  compact?: boolean;
}

/** Inline copy button with transient ✓ feedback for a single field value. */
function FieldCopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };
  return (
    <button
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="ml-1 inline-flex items-center text-current opacity-60 hover:opacity-100 transition-opacity"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export const ClaimReceipt: React.FC<ClaimReceiptProps> = ({
  claim,
  onShare,
  compact = false,
}) => {
  const { theme } = useTheme();
  const [copied, setCopied] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);

  const statusColors = {
    requested: 'bg-yellow-50 border-yellow-200 text-yellow-900 dark:bg-yellow-950/40 dark:border-yellow-800 dark:text-yellow-200',
    verified:  'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200',
    approved:  'bg-green-50 border-green-200 text-green-900 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200',
    disbursed: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200',
    archived:  'bg-gray-50 border-gray-200 text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200',
    cancelled: 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200',
  };

  const statusBadgeColors = {
    requested: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200',
    verified:  'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
    approved:  'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
    disbursed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    archived:  'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  };

  const formattedDate = useMemo(() => {
    try {
      return format(new Date(claim.timestamp), 'MMM dd, yyyy • HH:mm:ss');
    } catch {
      return claim.timestamp;
    }
  }, [claim.timestamp]);

  const receiptText = useMemo(() => {
    const lines = [
      'Claim Receipt',
      `Claim ID: ${claim.claimId}`,
      `Package ID: ${claim.packageId}`,
      `Status: ${claim.status.toUpperCase()}`,
      `Amount: ${claim.amount} tokens`,
      `Date: ${formattedDate}`,
    ];
    if (claim.tokenAddress) {
      lines.push(`Token Address: ${claim.tokenAddress}`);
    }
    if (claim.contractAddress) {
      lines.push(`Contract Address: ${claim.contractAddress}`);
    }
    if (claim.transactionHash) {
      lines.push(`Transaction Hash: ${claim.transactionHash}`);
    }
    if (claim.explorerLink) {
      lines.push(`Explorer Link: ${claim.explorerLink}`);
    }
    return lines.join('\n');
  }, [claim, formattedDate]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(receiptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy receipt', err);
    }
  };

  const handleShare = async () => {
    if (onShare) {
      setSharing(true);
      try {
        await onShare();
      } catch (err) {
        console.error('Failed to share receipt', err);
      } finally {
        setSharing(false);
      }
    } else if (navigator.share) {
      setSharing(true);
      try {
        await navigator.share({
          title: 'Claim Receipt',
          text: receiptText,
        });
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      } finally {
        setSharing(false);
      }
    }
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([receiptText], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `claim-receipt-${claim.claimId}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  if (compact) {
    return (
      <div className={`p-3 border rounded-lg ${statusColors[claim.status]}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{claim.packageId}</p>
            <p className="text-xs opacity-75">{formattedDate}</p>
          </div>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadgeColors[claim.status]}`}>
            {claim.status}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`border-2 rounded-lg p-6 ${statusColors[claim.status]}`}>
      {/* Header */}
      <div className="mb-4 pb-4 border-b border-current border-opacity-20">
        <h2 className="text-2xl font-bold mb-1">Claim Receipt</h2>
        <p className="text-sm opacity-75">Proof of claim completion</p>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold opacity-75 mb-1">CLAIM ID</p>
          <p className="font-mono text-sm break-all">{claim.claimId}</p>
        </div>
        <div>
          <p className="text-xs font-semibold opacity-75 mb-1">PACKAGE ID</p>
          <p className="font-mono text-sm break-all">{claim.packageId}</p>
        </div>
        <div>
          <p className="text-xs font-semibold opacity-75 mb-1">STATUS</p>
          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${statusBadgeColors[claim.status]}`}>
            {claim.status}
          </span>
        </div>
        <div>
          <p className="text-xs font-semibold opacity-75 mb-1">AMOUNT</p>
          <p className="font-semibold">{claim.amount} tokens</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs font-semibold opacity-75 mb-1">TIMESTAMP</p>
          <p className="text-sm">{formattedDate}</p>
        </div>
        {claim.tokenAddress && (
          <div className="col-span-2">
            <p className="text-xs font-semibold opacity-75 mb-1">TOKEN ADDRESS</p>
            <div className="flex items-center gap-1">
              <a
                href={buildExplorerUrl('address', claim.tokenAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all text-blue-600 hover:underline dark:text-blue-400 flex items-center gap-1"
              >
                {claim.tokenAddress}
                <ExternalLink size={12} className="shrink-0" />
              </a>
              <FieldCopyButton value={claim.tokenAddress} label="token address" />
            </div>
          </div>
        )}
        {claim.contractAddress && (
          <div className="col-span-2">
            <p className="text-xs font-semibold opacity-75 mb-1">CONTRACT ADDRESS</p>
            <div className="flex items-center gap-1">
              <a
                href={buildExplorerUrl('contract', claim.contractAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all text-blue-600 hover:underline dark:text-blue-400 flex items-center gap-1"
              >
                {claim.contractAddress}
                <ExternalLink size={12} className="shrink-0" />
              </a>
              <FieldCopyButton value={claim.contractAddress} label="contract address" />
            </div>
          </div>
        )}
        {claim.transactionHash && (
          <div className="col-span-2">
            <p className="text-xs font-semibold opacity-75 mb-1">TRANSACTION HASH</p>
            <div className="flex items-center gap-1">
              <a
                href={buildExplorerUrl('tx', claim.transactionHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs break-all text-blue-600 hover:underline dark:text-blue-400 flex items-center gap-1"
              >
                {claim.transactionHash}
                <ExternalLink size={12} className="shrink-0" />
              </a>
              <FieldCopyButton value={claim.transactionHash} label="transaction hash" />
            </div>
          </div>
        )}
        {claim.explorerLink && (
          <div className="col-span-2">
            <p className="text-xs font-semibold opacity-75 mb-1">VIEW ON EXPLORER</p>
            <a
              href={claim.explorerLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm underline hover:opacity-80 transition-opacity"
            >
              Open transaction in blockchain explorer
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-current bg-opacity-10 hover:bg-opacity-20 dark:bg-white/10 dark:hover:bg-white/20 transition-colors disabled:opacity-50 text-sm font-medium"
          title="Share receipt"
        >
          <Share2 size={16} />
          <span className="hidden sm:inline">Share</span>
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-current bg-opacity-10 hover:bg-opacity-20 dark:bg-white/10 dark:hover:bg-white/20 transition-colors text-sm font-medium"
          title="Copy to clipboard"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-current bg-opacity-10 hover:bg-opacity-20 dark:bg-white/10 dark:hover:bg-white/20 transition-colors text-sm font-medium"
          title="Download receipt"
        >
          <Download size={16} />
          <span className="hidden sm:inline">Download</span>
        </button>
      </div>
    </div>
  );
};
