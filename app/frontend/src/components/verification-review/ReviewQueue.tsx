'use client';

import React, { useCallback, useRef, useState } from 'react';
import { format } from 'date-fns';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  AlertCircle,
  RefreshCw,
  Keyboard,
  X,
} from 'lucide-react';
import { StatusBadge, RiskBadge } from './StatusBadge';
import { VerificationDetailPanel } from './VerificationDetailPanel';
import { QueueFreshnessBar } from './QueueFreshnessBar';
import { ReviewActionDialog } from './ReviewActionDialog';
import type { ReviewActionType } from './ReviewActionDialog';
import {
  useInboxWithLatency,
  useQueueRefreshStatus,
  useOptimisticItemState,
} from '@/hooks/useVerificationInbox';
import type { ReviewFilters, RiskLevel } from '@/types/verification-review';

interface ReviewQueueProps {
  filters: ReviewFilters;
  onPageChange: (page: number) => void;
}

const DETAIL_PANEL_ID = 'verification-detail-panel';

/** Keyboard shortcuts surfaced in the hint bar and the help overlay. */
const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'J / ↓', label: 'Next item' },
  { keys: 'K / ↑', label: 'Previous item' },
  { keys: 'E / Enter / Space', label: 'Expand details' },
  { keys: 'A', label: 'Approve focused item' },
  { keys: 'R', label: 'Reject focused item' },
  { keys: '?', label: 'Show keyboard help' },
  { keys: 'Esc', label: 'Close details or help' },
];

/** True when the keystroke belongs to a text field rather than a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

export function ReviewQueue({ filters, onPageChange }: ReviewQueueProps) {
  const { data, isLoading, isError, error, isFetching } = useInboxWithLatency(filters);
  const refreshStatus = useQueueRefreshStatus(filters);
  const { pendingIds, failedIds } = useOptimisticItemState();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [quickAction, setQuickAction] = useState<{
    id: string;
    action: ReviewActionType;
  } | null>(null);

  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  /** Moves both the roving tab index and DOM focus to `index`. */
  const focusItem = useCallback(
    (index: number, total: number) => {
      if (total <= 0) return;
      const clamped = Math.max(0, Math.min(index, total - 1));
      setFocusedIndex(clamped);
      // Focus after the ref settles so the target button is attached.
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => itemRefs.current[clamped]?.focus());
      }
    },
    [],
  );

  /**
   * Runs after any decision (approve / reject / resubmission) is accepted:
   * announces the outcome to assistive tech and moves focus predictably to the
   * next queue item, falling back to the previous one at the end of the list.
   */
  const handleDecisionComplete = useCallback(
    (action: ReviewActionType, id: string) => {
      const items = data?.items ?? [];
      const decidedIndex = items.findIndex(item => item.id === id);
      const verb =
        action === 'approve'
          ? 'Approved'
          : action === 'reject'
            ? 'Rejected'
            : 'Requested resubmission for';
      announce(`${verb} verification ${id}. Focus moved to the next item.`);

      setSelectedId(null);
      if (items.length === 0) return;
      const targetIndex =
        decidedIndex < 0
          ? Math.min(focusedIndex, items.length - 1)
          : decidedIndex + 1 < items.length
            ? decidedIndex + 1
            : Math.max(0, decidedIndex - 1);
      focusItem(targetIndex, items.length);
    },
    [announce, data, focusItem, focusedIndex],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(event.target)) return;
      const items = data?.items ?? [];
      if (items.length === 0) return;

      const currentIndex = Math.max(0, Math.min(focusedIndex, items.length - 1));
      const current = items[currentIndex];
      if (!current) return;

      const navigate = (nextIndex: number) => {
        event.preventDefault();
        const clamped = Math.max(0, Math.min(nextIndex, items.length - 1));
        focusItem(clamped, items.length);
        const target = items[clamped];
        if (target) {
          announce(
            `Item ${clamped + 1} of ${items.length}, verification ${target.id}.`,
          );
        }
      };

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          navigate(currentIndex + 1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          navigate(currentIndex - 1);
          break;
        case 'e':
        case 'E':
          event.preventDefault();
          setSelectedId(prev => (prev === current.id ? null : current.id));
          break;
        case 'a':
        case 'A':
          event.preventDefault();
          setQuickAction({ id: current.id, action: 'approve' });
          break;
        case 'r':
        case 'R':
          event.preventDefault();
          setQuickAction({ id: current.id, action: 'reject' });
          break;
        case '?':
          event.preventDefault();
          setHelpOpen(true);
          break;
        default:
          break;
      }
    },
    [announce, data, focusItem, focusedIndex],
  );

  // Initial hard load (no cached data yet)
  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        {/* Show a placeholder freshness bar while loading */}
        <div className="h-8 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="space-y-3">
        <div className="p-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
          Failed to load queue: {(error as Error).message}
        </div>
        <button
          onClick={refreshStatus.refresh}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="space-y-3">
        <QueueFreshnessBar status={refreshStatus} />
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500 gap-3">
          <Inbox size={36} strokeWidth={1.5} />
          <p className="text-sm">
            No verification cases match the current filters.
          </p>
        </div>
      </div>
    );
  }

  const items = data.items;
  const safeFocusedIndex = Math.max(0, Math.min(focusedIndex, items.length - 1));

  return (
    <div className="space-y-3" onKeyDown={handleKeyDown}>
      {/* Screen-reader announcement for queue navigation and decision outcomes */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="review-queue-announcer"
      >
        {announcement}
      </div>

      {/* ── Freshness bar ─────────────────────────────────────────────── */}
      <QueueFreshnessBar status={refreshStatus} />

      {/* ── Keyboard shortcut hint + help trigger ─────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400"
          data-testid="review-shortcuts-hint"
        >
          <Keyboard size={13} aria-hidden="true" />
          <span>
            <kbd className="font-mono font-semibold text-gray-700 dark:text-gray-200">J</kbd>/
            <kbd className="font-mono font-semibold text-gray-700 dark:text-gray-200">K</kbd>{' '}
            Navigate
          </span>
          <span>
            <kbd className="font-mono font-semibold text-gray-700 dark:text-gray-200">A</kbd>{' '}
            Approve
          </span>
          <span>
            <kbd className="font-mono font-semibold text-gray-700 dark:text-gray-200">R</kbd>{' '}
            Reject
          </span>
          <span>
            <kbd className="font-mono font-semibold text-gray-700 dark:text-gray-200">E</kbd>{' '}
            Details
          </span>
        </div>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={helpOpen}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Keyboard size={12} aria-hidden="true" />
          Keyboard shortcuts
        </button>
      </div>

      {/* ── Background-refetch shimmer on the list ────────────────────── */}
      {isFetching && !isLoading && (
        <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          <span>Syncing…</span>
        </div>
      )}

      <div
        className="flex gap-4 min-h-0"
        role="group"
        aria-label="Verification review queue"
      >
        {/* ── Queue list ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-2">
          {items.map((item, index) => {
            const isItemPending = pendingIds.has(item.id);
            const isItemFailed = failedIds.has(item.id);
            const isSelected = selectedId === item.id;

            return (
              <button
                key={item.id}
                ref={el => {
                  itemRefs.current[index] = el;
                }}
                onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                onFocus={() => setFocusedIndex(index)}
                tabIndex={index === safeFocusedIndex ? 0 : -1}
                disabled={isItemPending}
                aria-busy={isItemPending}
                aria-expanded={isSelected}
                aria-controls={isSelected ? DETAIL_PANEL_ID : undefined}
                aria-label={`Verification ${item.id}${isItemPending ? ' — action in progress' : ''}${isItemFailed ? ' — action failed' : ''}`}
                className={[
                  'w-full text-left px-4 py-3 rounded-lg border transition-colors relative',
                  isItemPending
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/15 cursor-wait opacity-85'
                    : isItemFailed
                      ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/15'
                      : isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-200 dark:hover:border-gray-700',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-mono text-xs text-gray-400 dark:text-gray-500 truncate max-w-[140px]">
                      {item.id}
                    </span>
                    <StatusBadge status={item.status} />
                    {item.riskLevel && (
                      <RiskBadge level={item.riskLevel as RiskLevel} />
                    )}

                    {/* Pending spinner */}
                    {isItemPending && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                        title="Action in progress…"
                      >
                        <Loader2
                          size={10}
                          className="animate-spin"
                          aria-hidden="true"
                        />
                        Saving…
                      </span>
                    )}

                    {/* Failed badge */}
                    {isItemFailed && !isItemPending && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                        title="Action failed — data has been rolled back"
                        role="alert"
                      >
                        <AlertCircle size={10} aria-hidden="true" />
                        Failed
                      </span>
                    )}
                  </div>

                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                    {format(new Date(item.createdAt), 'dd MMM yyyy')}
                  </span>
                </div>

                {item.nextStepMessage && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                    {item.nextStepMessage}
                  </p>
                )}

                {/* Failed retry hint */}
                {isItemFailed && !isItemPending && (
                  <p
                    className="mt-1 text-xs text-red-500 dark:text-red-400"
                    role="alert"
                  >
                    Action failed — please try again.
                  </p>
                )}
              </button>
            );
          })}

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Page {data.page} of {data.totalPages} · {data.total} total
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => onPageChange(data.page - 1)}
                  disabled={data.page <= 1}
                  aria-label="Previous page"
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => onPageChange(data.page + 1)}
                  disabled={data.page >= data.totalPages}
                  aria-label="Next page"
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div
            id={DETAIL_PANEL_ID}
            className="w-80 shrink-0 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col"
          >
            <VerificationDetailPanel
              verificationId={selectedId}
              onClose={() => setSelectedId(null)}
              onDecision={action => handleDecisionComplete(action, selectedId)}
            />
          </div>
        )}
      </div>

      {/* ── Quick action dialog launched from the keyboard ────────────── */}
      {quickAction && (
        <ReviewActionDialog
          verificationId={quickAction.id}
          action={quickAction.action}
          open={!!quickAction}
          onOpenChange={open => {
            if (!open) setQuickAction(null);
          }}
          onSuccess={action => handleDecisionComplete(action, quickAction.id)}
        />
      )}

      {/* ── Keyboard shortcuts help overlay ───────────────────────────── */}
      <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
          <Dialog.Content
            aria-labelledby="review-shortcuts-title"
            data-testid="review-shortcuts-help"
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4 focus:outline-none"
          >
            <div className="flex items-center justify-between">
              <Dialog.Title
                id="review-shortcuts-title"
                className="text-base font-semibold text-gray-900 dark:text-gray-100"
              >
                Keyboard shortcuts
              </Dialog.Title>
              <Dialog.Close
                aria-label="Close keyboard shortcuts"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              >
                <X size={18} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <dl className="space-y-2">
              {SHORTCUTS.map(shortcut => (
                <div
                  key={shortcut.keys}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <dt className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">
                    {shortcut.keys}
                  </dt>
                  <dd className="text-gray-600 dark:text-gray-300 text-right">
                    {shortcut.label}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Shortcuts work while focus is inside the review queue.
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
