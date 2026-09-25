'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Server,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { buildExplorerUrl } from '@/lib/explorer';
import {
  fetchDeploymentRecords,
  refreshContractCache,
  getActiveContractConfig,
  type DeploymentRecord,
} from '@/lib/contractMetadata';

/** One-shot inline copy button with ✓ feedback. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // clipboard unavailable — silently ignore
      },
    );
  };
  return (
    <button
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className="shrink-0 ml-1 inline-flex items-center opacity-50 hover:opacity-100 transition-opacity"
    >
      {copied ? (
        <Check size={13} className="text-green-600 dark:text-green-400" />
      ) : (
        <Copy size={13} />
      )}
    </button>
  );
}

const NETWORK_DOT: Record<string, string> = {
  testnet: 'bg-yellow-400',
  futurenet: 'bg-purple-400',
  mainnet: 'bg-emerald-500',
};

const NETWORK_BADGE: Record<string, string> = {
  testnet:
    'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-800',
  futurenet:
    'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-800',
  mainnet:
    'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800',
};

function networkLabel(network: string): string {
  const map: Record<string, string> = {
    testnet: 'Testnet',
    futurenet: 'Futurenet',
    mainnet: 'Mainnet',
    public: 'Mainnet',
  };
  return map[network.toLowerCase()] ?? network;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; records: DeploymentRecord[] };

/**
 * AdminContractRegistry
 *
 * Shows all deployment metadata records with copyable contract IDs, network labels,
 * explorer links, and deployment provenance. Admin-only surface.
 */
export const AdminContractRegistry: React.FC = () => {
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [refreshing, setRefreshing] = useState(false);
  const active = getActiveContractConfig();

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: 'loading' });
    try {
      const records = await fetchDeploymentRecords(signal);
      setState({ kind: 'ready', records });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load deployment records',
      });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshContractCache();
      await load();
    } catch {
      // surface as a toast in a real app; best-effort reload
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <Server className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Contract Registry
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Active deployment metadata — network labels, contract IDs, and provenance
            </p>
          </div>
        </div>
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing || state.kind === 'loading'}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Flush the Redis contract-config cache and reload"
        >
          <RefreshCw
            size={13}
            className={refreshing ? 'animate-spin' : ''}
            aria-hidden="true"
          />
          Refresh Cache
        </button>
      </div>

      {/* Active config banner */}
      <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold text-gray-700 dark:text-gray-300">Active (env):</span>
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${NETWORK_DOT[active.network] ?? 'bg-gray-400'}`}
            aria-hidden="true"
          />
          {active.networkLabel}
        </span>
        {active.contractId ? (
          <span className="flex items-center gap-1 font-mono">
            {active.contractId}
            <CopyButton value={active.contractId} label="active contract ID" />
            {active.explorerUrl && (
              <a
                href={active.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                aria-label="View on Stellar Expert"
              >
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </span>
        ) : (
          <span className="italic opacity-60">NEXT_PUBLIC_AID_ESCROW_CONTRACT_ID not set</span>
        )}
      </div>

      {/* Body */}
      <div className="p-6">
        {state.kind === 'idle' || state.kind === 'loading' ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-8 justify-center">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            Loading deployment records…
          </div>
        ) : state.kind === 'error' ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
            <AlertCircle
              size={18}
              className="text-red-500 dark:text-red-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Could not load deployment records
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                {state.message}
              </p>
              <button
                onClick={() => void load()}
                className="mt-2 text-xs text-red-700 dark:text-red-300 underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          </div>
        ) : state.records.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8 italic">
            No deployment records found. Add one via the API or deploy a contract.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {['Contract', 'Network', 'Contract ID', 'Deployed', 'Commit', 'Actions'].map(
                    (h) => (
                      <th
                        key={h}
                        scope="col"
                        className="py-2.5 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {state.records.map((r) => {
                  const contractExplorerUrl = buildExplorerUrl('contract', r.contractId, r.network);
                  const txExplorerUrl = r.transactionHash
                    ? buildExplorerUrl('tx', r.transactionHash, r.network)
                    : null;
                  const netKey = r.network.toLowerCase();

                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      {/* Contract name */}
                      <td className="py-3 pr-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {r.contractName}
                      </td>

                      {/* Network badge */}
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                            NETWORK_BADGE[netKey] ?? 'bg-gray-100 text-gray-700 border-gray-200'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${NETWORK_DOT[netKey] ?? 'bg-gray-400'}`}
                            aria-hidden="true"
                          />
                          {networkLabel(r.network)}
                        </span>
                      </td>

                      {/* Contract ID */}
                      <td className="py-3 pr-4 font-mono text-xs">
                        <div className="flex items-center gap-1 max-w-[22ch]">
                          <a
                            href={contractExplorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-blue-600 hover:underline dark:text-blue-400"
                            title={r.contractId}
                            aria-label={`View contract ${r.contractId} on Stellar Expert`}
                          >
                            {r.contractId}
                          </a>
                          <CopyButton value={r.contractId} label="contract ID" />
                          <a
                            href={contractExplorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                            aria-label="Open on Stellar Expert"
                          >
                            <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        </div>
                      </td>

                      {/* Deployed at */}
                      <td className="py-3 pr-4 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                        {new Date(r.deployedAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>

                      {/* Commit SHA */}
                      <td className="py-3 pr-4 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {r.commitSha ? (
                          <span className="flex items-center gap-1">
                            <span title={r.commitSha}>{r.commitSha.slice(0, 7)}</span>
                            <CopyButton value={r.commitSha} label="commit SHA" />
                          </span>
                        ) : (
                          <span className="opacity-40">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={contractExplorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
                          >
                            <ExternalLink size={12} aria-hidden="true" />
                            Contract
                          </a>
                          {txExplorerUrl && (
                            <a
                              href={txExplorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400 whitespace-nowrap"
                            >
                              <ExternalLink size={12} aria-hidden="true" />
                              Deploy Tx
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
