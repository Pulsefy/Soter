'use client';

import { cn } from '@/lib/utils';

type ActionType = 'pausing' | 'resuming' | 'archiving' | 'completing' | 'activating';

interface InlineFeedbackProps {
  isPending: boolean;
  action: ActionType;
  message?: string;
  className?: string;
}

const actionMessages: Record<ActionType, string> = {
  pausing: 'Pausing campaign...',
  resuming: 'Resuming campaign...',
  archiving: 'Archiving campaign...',
  completing: 'Completing campaign...',
  activating: 'Activating campaign...',
};

export function InlineFeedback({
  isPending,
  action,
  message,
  className,
}: InlineFeedbackProps) {
  if (!isPending) return null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gray-400 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-gray-400 border-t-transparent" />
      </span>
      <span>{message ?? actionMessages[action]}</span>
    </div>
  );
}

export function InlineFeedbackButton({ action }: { action: ActionType }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
      {actionMessages[action]}
    </span>
  );
}

export function OptimisticStatusBadge({
  status,
  isOptimistic,
}: {
  status: string;
  isOptimistic?: boolean;
}) {
  const statusStyles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    active: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
    paused: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
    completed: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
    archived: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  };

  return (
    <span
      className={cn(
        'relative rounded-full px-2 py-1 text-xs font-semibold',
        statusStyles[status] ?? 'bg-gray-100 text-gray-800',
        isOptimistic && 'animate-pulse'
      )}
    >
      {isOptimistic && (
        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      {status}
    </span>
  );
}
