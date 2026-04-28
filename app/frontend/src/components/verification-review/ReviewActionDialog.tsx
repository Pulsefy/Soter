'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, AlertCircle } from 'lucide-react';
import {
  useApproveVerification,
  useRejectVerification,
  useRequestResubmission,
} from '@/hooks/useVerificationInbox';

type ActionType = 'approve' | 'reject' | 'resubmission';

interface ReviewActionDialogProps {
  verificationId: string;
  action: ActionType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACTION_CONFIG: Record<
  ActionType,
  {
    title: string;
    confirmLabel: string;
    confirmClass: string;
    needsReason: boolean;
  }
> = {
  approve: {
    title: 'Approve Verification',
    confirmLabel: 'Approve',
    confirmClass:
      'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500',
    needsReason: false,
  },
  reject: {
    title: 'Reject Verification',
    confirmLabel: 'Reject',
    confirmClass: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
    needsReason: true,
  },
  resubmission: {
    title: 'Request Resubmission',
    confirmLabel: 'Request Resubmission',
    confirmClass:
      'bg-orange-600 hover:bg-orange-700 text-white focus:ring-orange-500',
    needsReason: true,
  },
};

export function ReviewActionDialog({
  verificationId,
  action,
  open,
  onOpenChange,
}: ReviewActionDialogProps) {
  const cfg = ACTION_CONFIG[action];

  const [reason, setReason] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const approve = useApproveVerification();
  const reject = useRejectVerification();
  const resubmit = useRequestResubmission();

  const isPending = approve.isPending || reject.isPending || resubmit.isPending;

  function reset() {
    setReason('');
    setNextStep('');
    setInternalNote('');
    setError(null);
  }

  async function handleConfirm() {
    setError(null);

    if (cfg.needsReason && !reason.trim()) {
      setError('A reason is required.');
      return;
    }

    try {
      if (action === 'approve') {
        await approve.mutateAsync({
          id: verificationId,
          payload: {
            nextStepMessage: nextStep || undefined,
            internalNote: internalNote || undefined,
          },
        });
      } else if (action === 'reject') {
        await reject.mutateAsync({
          id: verificationId,
          payload: {
            rejectionReason: reason,
            nextStepMessage: nextStep || undefined,
            internalNote: internalNote || undefined,
          },
        });
      } else {
        await resubmit.mutateAsync({
          id: verificationId,
          payload: {
            rejectionReason: reason,
            nextStepMessage:
              nextStep || 'Please resubmit the required documents.',
            internalNote: internalNote || undefined,
          },
        });
      }
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(
        (err as Error).message ?? 'Something went wrong. Please try again.',
      );
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={v => {
        if (!isPending) {
          reset();
          onOpenChange(v);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4 focus:outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {cfg.title}
            </Dialog.Title>
            <Dialog.Close
              disabled={isPending}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
            >
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            {cfg.needsReason && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  placeholder={
                    action === 'reject'
                      ? 'e.g. Document appears fraudulent'
                      : 'e.g. ID document is expired'
                  }
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Next step message{' '}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={nextStep}
                onChange={e => setNextStep(e.target.value)}
                placeholder="Instructions shown to the applicant"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Internal note{' '}
                <span className="text-gray-400 font-normal">(staff only)</span>
              </label>
              <textarea
                value={internalNote}
                onChange={e => setInternalNote(e.target.value)}
                rows={2}
                placeholder="Private note for the review team"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-1">
            <Dialog.Close
              disabled={isPending}
              className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </Dialog.Close>
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed ${cfg.confirmClass}`}
            >
              {isPending ? 'Saving…' : cfg.confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
