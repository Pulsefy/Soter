'use client';

import React, { useState } from 'react';
import { X, MessageSquare, Send, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { StatusBadge, RiskBadge } from './StatusBadge';
import { ReviewActionDialog } from './ReviewActionDialog';
import {
  useVerificationDetail,
  useVerificationNotes,
  useAddNote,
} from '@/hooks/useVerificationInbox';
import type { RiskLevel } from '@/types/verification-review';

interface VerificationDetailPanelProps {
  verificationId: string;
  onClose: () => void;
}

function AiScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.7
      ? 'bg-green-500'
      : score >= 0.4
        ? 'bg-yellow-500'
        : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>AI Score</span>
        <span className="font-medium text-gray-700 dark:text-gray-200">
          {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function VerificationDetailPanel({
  verificationId,
  onClose,
}: VerificationDetailPanelProps) {
  const { data: item, isLoading } = useVerificationDetail(verificationId);
  const { data: notes } = useVerificationNotes(verificationId);
  const addNote = useAddNote(verificationId);

  const [noteText, setNoteText] = useState('');
  const [activeAction, setActiveAction] = useState<
    'approve' | 'reject' | 'resubmission' | null
  >(null);

  async function handleAddNote() {
    if (!noteText.trim()) return;
    await addNote.mutateAsync({ content: noteText.trim() });
    setNoteText('');
  }

  const canReview =
    item?.status === 'pending_review' || item?.status === 'needs_resubmission';

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight size={14} className="text-gray-400 shrink-0" />
            <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
              {verificationId}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {isLoading || !item ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="h-8 rounded bg-gray-100 dark:bg-gray-800"
                />
              ))}
            </div>
          ) : (
            <>
              {/* Status + risk */}
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={item.status} />
                {item.riskLevel && (
                  <RiskBadge level={item.riskLevel as RiskLevel} />
                )}
              </div>

              {/* Evidence summary */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Evidence Summary
                </h3>
                <dl className="space-y-1.5 text-sm">
                  {item.documentType && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">
                        Document type
                      </dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
                        {item.documentType}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500 dark:text-gray-400">
                      Submitted
                    </dt>
                    <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
                      {format(new Date(item.createdAt), 'dd MMM yyyy, HH:mm')}
                    </dd>
                  </div>
                  {item.reviewedAt && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">
                        Reviewed
                      </dt>
                      <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
                        {format(
                          new Date(item.reviewedAt),
                          'dd MMM yyyy, HH:mm',
                        )}
                      </dd>
                    </div>
                  )}
                  {item.reviewedBy && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500 dark:text-gray-400">
                        Reviewer
                      </dt>
                      <dd className="font-mono text-xs text-gray-700 dark:text-gray-300 text-right truncate max-w-[160px]">
                        {item.reviewedBy}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* AI score */}
              {typeof item.aiScore === 'number' && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    AI Analysis
                  </h3>
                  <AiScoreBar score={item.aiScore} />
                </section>
              )}

              {/* Rejection reason */}
              {item.rejectionReason && (
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    Rejection Reason
                  </h3>
                  <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                    {item.rejectionReason}
                  </p>
                </section>
              )}

              {/* Next step message */}
              {item.nextStepMessage && (
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    Next Step
                  </h3>
                  <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                    {item.nextStepMessage}
                  </p>
                </section>
              )}

              {/* Reviewer decision history (notes) */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                  <MessageSquare size={12} />
                  Reviewer Notes
                </h3>
                {!notes || notes.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                    No notes yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {notes.map(note => (
                      <li
                        key={note.id}
                        className="text-sm bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 space-y-0.5"
                      >
                        <p className="text-gray-700 dark:text-gray-300">
                          {note.content}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          {note.authorId} ·{' '}
                          {format(
                            new Date(note.createdAt),
                            'dd MMM yyyy, HH:mm',
                          )}
                          {note.category && ` · ${note.category}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Add note */}
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void handleAddNote()}
                    placeholder="Add a note…"
                    className="flex-1 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors"
                  />
                  <button
                    onClick={() => void handleAddNote()}
                    disabled={!noteText.trim() || addNote.isPending}
                    className="h-8 w-8 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={13} />
                  </button>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Action buttons */}
        {canReview && (
          <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 shrink-0 flex gap-2">
            <button
              onClick={() => setActiveAction('approve')}
              className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => setActiveAction('resubmission')}
              className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors"
            >
              Resubmit
            </button>
            <button
              onClick={() => setActiveAction('reject')}
              className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
            >
              Reject
            </button>
          </div>
        )}
      </div>

      {activeAction && (
        <ReviewActionDialog
          verificationId={verificationId}
          action={activeAction}
          open={!!activeAction}
          onOpenChange={open => !open && setActiveAction(null)}
        />
      )}
    </>
  );
}
