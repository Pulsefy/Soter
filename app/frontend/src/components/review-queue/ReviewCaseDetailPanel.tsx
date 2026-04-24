'use client';

import { useState } from 'react';
import type { ReviewCaseDetail } from '@/types/review-case';
import { useApproveReviewCase, useRejectReviewCase } from '@/hooks/useReviewQueue';
import { AlertCircle, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface ReviewCaseDetailPanelProps {
  reviewCase: ReviewCaseDetail | null;
  onActionComplete?: () => void;
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const percentage = Math.round(score * 100);
  const color = percentage >= 70 ? 'text-emerald-500' : percentage >= 50 ? 'text-amber-500' : 'text-red-500';

  return (
    <div className="flex flex-col items-center">
      <div className={`text-2xl font-bold ${color}`}>{percentage}%</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}

function HistoryItem({ entry }: { entry: ReviewCaseDetail['history'][number] }) {
  const date = new Date(entry.timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const actionColors: Record<string, string> = {
    enqueue: 'text-blue-600 dark:text-blue-400',
    complete: 'text-emerald-600 dark:text-emerald-400',
    approve: 'text-emerald-600 dark:text-emerald-400',
    reject: 'text-red-600 dark:text-red-400',
    update: 'text-amber-600 dark:text-amber-400',
  };

  const actorLabel = entry.actorId === 'system' ? 'System' : `Reviewer ${entry.actorId.slice(0, 8)}`;

  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className={`mt-0.5 text-xs font-semibold uppercase ${actionColors[entry.action] ?? 'text-gray-600 dark:text-gray-400'}`}>
        {entry.action}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs text-gray-500 dark:text-gray-400">{date}</p>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">·</span>
          <p className="text-xs text-gray-500 dark:text-gray-400">{actorLabel}</p>
        </div>
        {entry.metadata && typeof entry.metadata === 'object' && 'notes' in entry.metadata && entry.metadata.notes && (
          <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{String(entry.metadata.notes)}</p>
        )}
      </div>
    </div>
  );
}

export function ReviewCaseDetailPanel({ reviewCase, onActionComplete }: ReviewCaseDetailPanelProps) {
  const [notes, setNotes] = useState('');
  const approveMutation = useApproveReviewCase();
  const rejectMutation = useRejectReviewCase();

  if (!reviewCase) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 p-8">
        <AlertCircle className="w-10 h-10 mb-3" />
        <p className="text-sm">Select a case to view details</p>
      </div>
    );
  }

  const isPending = reviewCase.status === 'pending';
  const isLoading = approveMutation.isPending || rejectMutation.isPending;
  const error = approveMutation.error ?? rejectMutation.error;

  const handleApprove = () => {
    approveMutation.mutate(
      { id: reviewCase.id, notes: notes || undefined },
      { onSuccess: onActionComplete },
    );
  };

  const handleReject = () => {
    rejectMutation.mutate(
      { id: reviewCase.id, notes: notes || undefined },
      { onSuccess: onActionComplete },
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Case Details</h2>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              reviewCase.status === 'pending'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : reviewCase.status === 'approved'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
            }`}
          >
            {reviewCase.status.charAt(0).toUpperCase() + reviewCase.status.slice(1)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <ScoreRing score={reviewCase.aiScore} label="AI Score" />
          <ScoreRing score={reviewCase.confidence} label="Confidence" />
          <div className="flex flex-col items-center">
            <div className={`text-2xl font-bold capitalize ${
              reviewCase.riskLevel === 'low'
                ? 'text-emerald-500'
                : reviewCase.riskLevel === 'medium'
                ? 'text-amber-500'
                : 'text-red-500'
            }`}>
              {reviewCase.riskLevel}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Risk Level</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Claim Info */}
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
            Claim Information
          </h3>
          <div className="space-y-1 text-sm">
            <p><span className="text-gray-500 dark:text-gray-400">ID:</span> {reviewCase.claim.id}</p>
            <p><span className="text-gray-500 dark:text-gray-400">Campaign:</span> {reviewCase.claim.campaign.name}</p>
            <p><span className="text-gray-500 dark:text-gray-400">Recipient:</span> {reviewCase.claim.recipientRef}</p>
            <p><span className="text-gray-500 dark:text-gray-400">Amount:</span> {reviewCase.claim.amount}</p>
            <p><span className="text-gray-500 dark:text-gray-400">Submitted:</span> {new Date(reviewCase.claim.createdAt).toLocaleDateString()}</p>
          </div>
        </section>

        {/* Evidence */}
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
            Evidence Summary
          </h3>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {reviewCase.evidenceSummary ?? reviewCase.claim.evidenceRef ?? 'No evidence provided.'}
            </p>
          </div>
        </section>

        {/* AI Factors */}
        {reviewCase.factors && reviewCase.factors.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              AI Assessment Factors
            </h3>
            <ul className="space-y-1">
              {reviewCase.factors.map((factor, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500 flex-shrink-0" />
                  {factor}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Recommendations */}
        {reviewCase.recommendations && reviewCase.recommendations.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Recommendations
            </h3>
            <ul className="space-y-1">
              {reviewCase.recommendations.map((rec, i) => (
                <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                  {rec}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Decision History */}
        {reviewCase.history && reviewCase.history.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Decision History
            </h3>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              {reviewCase.history.map((entry) => (
                <HistoryItem key={entry.id} entry={entry} />
              ))}
            </div>
          </section>
        )}

        {/* Reviewer Notes Input */}
        {isPending && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Reviewer Notes
            </h3>
            <textarea
              value={notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
              placeholder="Add notes before making a decision…"
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </section>
        )}

        {reviewCase.reviewerNotes && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              Previous Notes
            </h3>
            <p className="text-sm text-gray-700 dark:text-gray-300">{reviewCase.reviewerNotes}</p>
          </section>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error.message}
          </div>
        )}
      </div>

      {/* Actions */}
      {isPending && (
        <div className="p-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleApprove}
              disabled={isLoading}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {approveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Approve
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isLoading}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {rejectMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
