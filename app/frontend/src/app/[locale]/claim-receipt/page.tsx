'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClaimReceipt, ClaimReceiptData } from '@/components/ClaimReceipt';
import { AlertCircle, Loader2, Clock, FileSearch } from 'lucide-react';
import { fetchClient } from '@/lib/mock-api/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const PENDING_STATUSES: ClaimReceiptData['status'][] = [
  'requested',
  'verified',
  'approved',
];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found'; identifierType: 'claim' | 'package' | 'unknown' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: ClaimReceiptData };

export default function ClaimReceiptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const claimId = searchParams.get('claimId');
  const packageId = searchParams.get('packageId');
  const identifier = claimId ?? packageId;
  const identifierType = claimId
    ? 'claim'
    : packageId
      ? 'package'
      : 'unknown';

  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!identifier) {
      setState({ kind: 'not-found', identifierType: 'unknown' });
      return;
    }

    const abortCtrl = new AbortController();

    const loadReceipt = async () => {
      setState({ kind: 'loading' });
      try {
        const response = await fetchClient(
          `${API_URL}/claims/${encodeURIComponent(identifier)}/receipt`,
          {
            signal: abortCtrl.signal,
            cache: 'no-store',
          },
        );

        if (response.status === 404) {
          setState({ kind: 'not-found', identifierType });
          return;
        }

        if (!response.ok) {
          let msg = `Server responded with ${response.status}`;
          try {
            const body = (await response.json()) as
              | { message?: string; error?: string }
              | undefined;
            if (body?.message) msg = body.message;
            else if (body?.error) msg = body.error;
          } catch {
            /* ignore body parse errors */
          }
          setState({ kind: 'error', message: msg });
          return;
        }

        const data = (await response.json()) as ClaimReceiptData;
        setState({ kind: 'ready', data });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const message =
          err instanceof Error ? err.message : 'Failed to load claim receipt';
        setState({ kind: 'error', message });
      }
    };

    void loadReceipt();

    return () => {
      abortCtrl.abort();
    };
  }, [identifier, identifierType]);

  const handleShare = async () => {
    if (state.kind !== 'ready') return;
    const claim = state.data;

    const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Claim Receipt',
          text: `Claim ${claim.claimId} - ${claim.status}`,
          url: claim.explorerLink ?? pageUrl,
        });
      } else {
        // Fallback: copy URL to clipboard
        await navigator.clipboard.writeText(pageUrl);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-blue-600 dark:text-blue-400 hover:underline mb-4 flex items-center gap-2"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
            Claim Receipt
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            View and share your claim proof
          </p>
        </div>

        {/* Loading State */}
        {state.kind === 'loading' && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 text-center">
            <Loader2 className="inline-block animate-spin text-blue-600 dark:text-blue-400 mb-4" size={32} />
            <p className="text-slate-600 dark:text-slate-400">
              Loading your receipt…
            </p>
          </div>
        )}

        {/* Not Found State */}
        {state.kind === 'not-found' && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6 flex gap-4">
            <FileSearch className="text-amber-600 dark:text-amber-400 flex-shrink-0" size={24} />
            <div>
              <h2 className="font-semibold text-amber-900 dark:text-amber-100 mb-1">
                Receipt not found
              </h2>
              <p className="text-amber-800 dark:text-amber-200 mb-3">
                {identifierType === 'unknown'
                  ? 'No claim or package identifier was provided in the URL.'
                  : `We could not find a receipt for the provided ${identifierType} identifier. It may have been deleted or the link is incorrect.`}
              </p>
              <button
                onClick={() => router.back()}
                className="inline-block text-amber-700 dark:text-amber-300 font-medium hover:underline text-sm"
              >
                ← Return to previous page
              </button>
            </div>
          </div>
        )}

        {/* Generic Error State */}
        {state.kind === 'error' && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 flex gap-4">
            <AlertCircle className="text-red-600 dark:text-red-400 flex-shrink-0" size={24} />
            <div>
              <h2 className="font-semibold text-red-900 dark:text-red-100 mb-1">
                Unable to load receipt
              </h2>
              <p className="text-red-800 dark:text-red-200">{state.message}</p>
            </div>
          </div>
        )}

        {/* Ready: Receipt Card + Supporting UI */}
        {state.kind === 'ready' && (
          <div className="space-y-4">
            {/* Pending status callout */}
            {PENDING_STATUSES.includes(state.data.status) && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex gap-3">
                <Clock className="text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-0.5">
                    Claim is {state.data.status}
                  </h3>
                  <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                    This claim has not been disbursed yet. A transaction link
                    will appear here once the on-chain disbursement is
                    finalized.
                  </p>
                </div>
              </div>
            )}

            <ClaimReceipt claim={state.data} onShare={handleShare} />

            {/* Additional Information */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                What is this receipt?
              </h2>
              <ul className="space-y-3 text-slate-700 dark:text-slate-300">
                <li className="flex gap-3">
                  <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                  <span>
                    This receipt proves that your claim has been processed on
                    the Soter platform.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                  <span>
                    You can share this receipt with other parties as proof of
                    the transaction.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                  <span>
                    Keep this receipt for your records. Once the on-chain
                    transaction is finalized, data is immutable.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                  <span>
                    You can download, copy, or share this receipt using the
                    buttons above.
                  </span>
                </li>
              </ul>
            </div>

            {/* Support Information */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
              <h3 className="font-semibold text-slate-950 dark:text-blue-100 mb-2">
                Need help?
              </h3>
              <p className="text-blue-800 dark:text-blue-200 text-sm">
                If you have questions about your claim or receipt, please
                contact our support team at support@soter.app
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
