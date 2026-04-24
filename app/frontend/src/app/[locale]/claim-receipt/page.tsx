'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClaimReceipt, ClaimReceiptData } from '@/components/ClaimReceipt';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function ClaimReceiptPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const claimId = searchParams.get('claimId');

  const [claim, setClaim] = useState<ClaimReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) {
      setError('Claim ID not provided');
      setLoading(false);
      return;
    }

    const loadClaim = async () => {
      try {
        setLoading(true);
        // TODO: Replace with actual API call
        // const response = await fetch(`/api/claims/${claimId}/receipt`);
        // if (!response.ok) throw new Error('Failed to load receipt');
        // const data: ClaimReceiptData = await response.json();

        // Mock data for now
        const data: ClaimReceiptData = {
          claimId,
          packageId: 'pkg-' + Math.random().toString(36).substr(2, 9),
          status: 'disbursed',
          amount: 150.5,
          tokenAddress:
            'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          timestamp: new Date().toISOString(),
        };

        setClaim(data);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load claim receipt',
        );
      } finally {
        setLoading(false);
      }
    };

    void loadClaim();
  }, [claimId]);

  const handleShare = async () => {
    if (!claim) return;

    try {
      // Try Web Share API first
      if (navigator.share) {
        await navigator.share({
          title: 'Claim Receipt',
          text: `Claim ${claim.claimId} - ${claim.status}`,
        });
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
        {loading && (
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-8 text-center">
            <Loader2 className="inline-block animate-spin text-blue-600 dark:text-blue-400 mb-4" size={32} />
            <p className="text-slate-600 dark:text-slate-400">
              Loading your receipt…
            </p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 flex gap-4">
            <AlertCircle className="text-red-600 dark:text-red-400 flex-shrink-0" size={24} />
            <div>
              <h2 className="font-semibold text-red-900 dark:text-red-100 mb-1">
                Error
              </h2>
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          </div>
        )}

        {/* Receipt Card */}
        {!loading && claim && (
          <div className="space-y-4">
            <ClaimReceipt claim={claim} onShare={handleShare} />

            {/* Additional Information */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 border border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                What is this receipt?
              </h2>
              <ul className="space-y-3 text-slate-700 dark:text-slate-300">
                <li className="flex gap-3">
                  <span className="text-blue-600 dark:text-blue-400 font-bold">•</span>
                  <span>
                    This receipt proves that your claim has been processed and
                    completed on the Soter platform.
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
                    Keep this receipt for your records. The data cannot be
                    altered after generation.
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
              <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
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
