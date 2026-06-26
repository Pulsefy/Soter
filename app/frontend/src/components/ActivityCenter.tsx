'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X, ExternalLink, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFormatter } from '@/hooks/useFormatter';
import { useActivityStore } from '@/lib/activityStore';
import type { ActivityStatus } from '@/types/activity';

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

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const pendingCount = activities.filter(
    a => a.status === 'pending' || a.status === 'processing',
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

  const handleRetry = async (activity: any) => {
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

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(prev => !prev)}
        className="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        aria-label={
          pendingCount > 0
            ? `Activity center, ${pendingCount} active`
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
                {activities.length > 0 && (
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
            {activities.length === 0 ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                <Bell size={24} aria-hidden="true" className="mx-auto mb-2 opacity-50" />
                <p>{t('activity.noRecentActivity')}</p>
              </div>
            ) : (
              <ul className="p-2 list-none" aria-label="Recent activities">
                {activities.map(activity => {
                  const StatusIcon = statusIcons[activity.status];
                  const isSpinning = activity.status === 'processing';

                  return (
                    <li
                      key={activity.id}
                      className="group p-3 rounded-lg border border-slate-200 dark:border-slate-700 mb-2 last:mb-0 hover:bg-slate-50 dark:hover:bg-slate-700/50"
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
