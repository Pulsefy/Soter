/**
 * Inline Feedback Component for Campaign Actions
 * 
 * Provides visual feedback directly on campaign cards during mutations.
 * Used alongside toast notifications for mutation-heavy screens.
 * 
 * @example
 * ```tsx
 * <InlineFeedback
 *   isPending={campaignAction.isPending}
 *   action="pausing"
 * />
 * ```
 */

'use client';

import { cn } from '@/lib/utils';

type ActionType = 'pausing' | 'resuming' | 'archiving' | 'completing' | 'activating';

interface InlineFeedbackProps {
  /** Whether the mutation is currently pending */
  isPending: boolean;
  /** The action being performed */
  action: ActionType;
  /** Optional custom message */
  message?: string;
  /** CSS className for custom styling */
  className?: string;
}

const actionMessages: Record<ActionType, string> = {
  pausing: 'Pausing campaign...',
  resuming: 'Resuming campaign...',
  archiving: 'Archiving campaign...',
  completing: 'Completing campaign...',
  activating: 'Activating campaign...',
};

/**
 * Inline feedback spinner/indicator for campaign actions.
 * Displays a subtle loading state directly on the campaign card.
 */
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
        'inline-flex items-center gap-2 text-sm text-gray-500',
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

/**
 * Compact inline feedback for button loading states.
 * 
 * @example
 * ```tsx
 * <Button disabled={isPending}>
 *   {isPending ? <InlineFeedbackButton action="pausing" /> : 'Pause'}
 * </Button>
 * ```
 */
export function InlineFeedbackButton({ action }: { action: ActionType }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
      {actionMessages[action]}
    </span>
  );
}

/**
 * Status badge that shows optimistic state with visual indicator.
 * 
 * @example
 * ```tsx
 * <OptimisticStatusBadge
 *   status={campaign.status}
 *   isOptimistic={isPending}
 * />
 * ```
 */
export function OptimisticStatusBadge({
  status,
  isOptimistic,
}: {
  status: string;
  isOptimistic?: boolean;
}) {
  const statusStyles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    active: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-blue-100 text-blue-800',
    archived: 'bg-red-100 text-red-800',
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

export { InlineFeedback, InlineFeedbackButton, OptimisticStatusBadge };