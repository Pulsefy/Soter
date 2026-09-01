'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X, ExternalLink, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFormatter } from '@/hooks/useFormatter';
import { useActivityStore } from '@/lib/activityStore';
import { useActivityFeed } from '@/hooks/useActivity';
import type { ActivityItem, ActivityStatus } from '@/types/activity';

const statusIcons: Record<ActivityStatus, React.ComponentType<{ size?: number; className?: string }>> = {
  pending: Clock,
  processing: RefreshCw,
  succeeded: CheckCircle,
  failed: XCircle,
};

const statusColors: Record<ActivityStatus, string> = {
  pending: 'text-yellow-600 dark:text-yellow-400',
  processing: 'text-blue-600 dark:text-blue-400',
  succeeded: 'text-green-600 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
};

/** All HTML elements that can receive keyboard focus. */
const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ActivityCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations();
  const { formatRelativeTimeValue } = useFormatter();
  const { activities, removeActivity, clearCompleted, updateActivity } = useActivityStore();
  const { data: feedItems = [], isLoading, isError, refetch } = useActivityFeed();
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = window.localStorage.getItem('activity-center-read-ids');
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const mergedActivities: ActivityItem[] = feedItems.length > 0
    ? feedItems.map(item => ({ ...item, read: readIds.has(item.id) || item.read }))
    : activities;

  const pendingCount = mergedActivities.filter(
    a => a.status === 'pending' || a.status === 'processing' || !a.read,
  ).length;

  /** Close the panel and return focus to the trigger button. */
  const closePanel = useCallback(() => {
    setIsOpen(false);
    // Focus return happens in the useEffect below once isOpen flips.
  }, []);

  /** Move initial focus into the panel when it opens. */
  useEffect(() => {
    if (!isOpen) {
      triggerRef.current?.focus();
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
    firstFocusable?.focus();
  }, [isOpen]);

  /** Escape key closes the panel from anywhere on the page while it is open. */
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, closePanel]);

  /** Focus trap — keep Tab / Shift+Tab cycling within the panel. */
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusableEls = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
    );
    if (focusableEls.length === 0) return;

    const first = focusableEls[0];
    const last = focusableEls[focusableEls.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handleRetry = async (activity: ActivityItem) => {
    if (activity.retryAction) {
      updateActivity(activity.id, {
        status: 'pending',
        currentStep: 'Retrying...',
        errorMessage: undefined,
      });
      try {
        await activity.retryAction();
      } catch (error) {
        console.error('Retry failed:', error);
      }
    }
  };

  const markAsRead = (id: string) => {
    setReadIds(previous => {
      const next = new Set(previous);
      next.add(id);
      window.localStorage.setItem(
        'activity-center-read-ids',
        JSON.stringify(Array.from(next).slice(-200)),
      );
      return next;
    });
  };

  const markAllAsRead = () => {
    setReadIds(previous => {
      const next = new Set(previous);
      mergedActivities.forEach(activity => next.add(activity.id));
      window.localStorage.setItem(
        'activity-center-read-ids',
        JSON.stringify(Array.from(next).slice(-200)),
      );
      return next;
    });
  };

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(prev => !prev)}
        className="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        aria-label={
          pendingCount > 0
            ? `Activity center, ${pendingCount} active or unread`
            : 'Activity center'
        }
        aria-expanded={isOpen}
        aria-controls="activity-center-panel"
        aria-haspopup="true"
      >
        <Bell size={20} aria-hidden="true" />
        {pendingCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center"
          >
            {pendingCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div
          id="activity-center-panel"
          ref={panelRef}
          role="dialog"
          aria-label="Activity center"
          aria-modal="false"
          onKeyDown={handlePanelKeyDown}
          className="absolute right-0 mt-2 w-96 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50"
        >
          {/* Panel header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold" id="activity-center-title">
                {t('activity.center')}
              </h3>
              <div className="flex items-center gap-2">
                {mergedActivities.length > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    Mark all read
                  </button>
                )}
                {activities.length > 0 && feedItems.length === 0 && (
                  <button
                    onClick={clearCompleted}
                    className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    {t('activity.clearCompleted')}
                  </button>
                )}
                <button
                  onClick={closePanel}
                  aria-label="Close activity center"
                  className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Activity list */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                <RefreshCw size={24} aria-hidden="true" className="mx-auto mb-2 animate-spin opacity-60" />
                <p>Loading operational activity...</p>
              </div>
            ) : isError ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                <AlertCircle size={24} aria-hidden="true" className="mx-auto mb-2 text-red-500" />
                <p>Activity feed is unavailable.</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="mt-3 rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700"
                >
                  Retry
                </button>
              </div>
            ) : mergedActivities.length === 0 ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                <Bell size={24} aria-hidden="true" className="mx-auto mb-2 opacity-50" />
                <p>No operational notifications, audits, or review updates yet.</p>
              </div>
            ) : (
              <ul className="p-2 list-none" aria-label="Recent activities">
                {mergedActivities.map(activity => {
                  const StatusIcon = statusIcons[activity.status];
                  const isSpinning = activity.status === 'processing';
                  const isUnread = !activity.read;

                  return (
                    <li
                      key={activity.id}
                      className={`group p-3 rounded-lg border mb-2 last:mb-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 ${
                        isUnread
                          ? 'border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/30'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <StatusIcon
                          size={20}
                          aria-hidden="true"
                          className={`${statusColors[activity.status]} ${isSpinning ? 'animate-spin' : ''} mt-0.5 flex-shrink-0`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <h4 className="font-medium text-sm text-slate-900 dark:text-slate-100">
                                {activity.title}
                                {isUnread && (
                                  <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                                    Unread
                                  </span>
                                )}
                              </h4>
                              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                {activity.description}
                              </p>
                              {activity.currentStep && (
                                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                                  {activity.currentStep}
                                </p>
                              )}
                              {activity.errorMessage && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                                  <AlertCircle size={12} aria-hidden="true" />
                                  {activity.errorMessage}
                                </p>
                              )}
                              {activity.correlationId && (
                                <p className="mt-1 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  correlation: {activity.correlationId}
                                </p>
                              )}
                            </div>
                            {/* Remove button — always reachable via Tab, visually hidden until hover/focus */}
                            <button
                              onClick={() => removeActivity(activity.id)}
                              aria-label={`Remove activity: ${activity.title}`}
                              className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {(() => {
                                const { key, count } = formatRelativeTimeValue(activity.timestamp);
                                return count > 0 ? t(key, { count }) : t(key);
                              })()}
                            </span>
                            <div className="flex items-center gap-2">
                              {isUnread && (
                                <button
                                  onClick={() => markAsRead(activity.id)}
                                  className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                >
                                  Mark read
                                </button>
                              )}
                              {activity.retryAction && activity.status === 'failed' && (
                                <button
                                  onClick={() => handleRetry(activity)}
                                  className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                >
                                  {t('common.retry')}
                                </button>
                              )}
                              {activity.explorerUrl && (
                                <a
                                  href={activity.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`View transaction for ${activity.title} on explorer, opens in new tab`}
                                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                                >
                                  {t('activity.viewTransaction')}
                                  <ExternalLink size={12} aria-hidden="true" />
                                </a>
                              )}
                              {activity.linkHref && (
                                <a
                                  href={activity.linkHref}
                                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                                >
                                  {activity.linkLabel ?? 'Open'}
                                  <ExternalLink size={12} aria-hidden="true" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
