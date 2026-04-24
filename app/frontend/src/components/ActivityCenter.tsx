'use client';

import React, { useState } from 'react';
import { Bell, X, ExternalLink, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
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

export function ActivityCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations();
  const { activities, removeActivity, clearCompleted, updateActivity } = useActivityStore();

  const pendingCount = activities.filter(a => a.status === 'pending' || a.status === 'processing').length;

  const handleRetry = async (activity: any) => {
    if (activity.retryAction) {
      // Reset activity to pending state
      updateActivity(activity.id, {
        status: 'pending',
        currentStep: 'Retrying...',
        errorMessage: undefined,
      });

      try {
        if (activity.type === 'transaction') {
          await activity.retryAction();
        } else {
          await activity.retryAction();
        }
      } catch (error) {
        // Error handling is done in the retryAction itself
        console.error('Retry failed:', error);
      }
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        aria-label="Activity center"
      >
        <Bell size={20} />
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {pendingCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('activity.center')}</h3>
              <div className="flex items-center gap-2">
                {activities.length > 0 && (
                  <button
                    onClick={clearCompleted}
                    className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {t('activity.clearCompleted')}
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {activities.length === 0 ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                <Bell size={24} className="mx-auto mb-2 opacity-50" />
                <p>{t('activity.noRecentActivity')}</p>
              </div>
            ) : (
              <div className="p-2">
                {activities.map((activity) => {
                  const StatusIcon = statusIcons[activity.status];
                  const isSpinning = activity.status === 'processing';

                  return (
                    <div
                      key={activity.id}
                      className="group p-3 rounded-lg border border-slate-200 dark:border-slate-700 mb-2 last:mb-0 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    >
                      <div className="flex items-start gap-3">
                        <StatusIcon
                          size={20}
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
                                  <AlertCircle size={12} />
                                  {activity.errorMessage}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => removeActivity(activity.id)}
                              className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
                              title={t('activity.remove')}
                            >
                              <X size={14} />
                            </button>
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {activity.timestamp.toLocaleString()}
                            </span>
                            <div className="flex items-center gap-2">
                              {activity.retryAction && activity.status === 'failed' && (
                                <button
                                  onClick={() => handleRetry(activity)}
                                  className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
                                >
                                  {t('common.retry')}
                                </button>
                              )}
                              {activity.explorerUrl && (
                                <a
                                  href={activity.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 flex items-center gap-1"
                                >
                                  {t('activity.viewTransaction')} <ExternalLink size={12} />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}