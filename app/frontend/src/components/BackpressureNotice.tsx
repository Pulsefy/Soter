'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueueBackpressure } from '@/hooks/useQueueBackpressure';

/**
 * Non-blocking notice shown while the backend job queues are under heavy load,
 * so a slow approval or submission is understood as expected. Uses a polite
 * status region (not an alert) and renders nothing when load is normal.
 */
export const BackpressureNotice: React.FC = () => {
  const t = useTranslations();
  const { active, level } = useQueueBackpressure();

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="backpressure-notice"
      data-level={level}
      className="w-full border-b border-blue-600 bg-blue-900/40 px-4 py-2 text-blue-200 text-sm"
    >
      <div className="flex items-center gap-3">
        <Clock className="shrink-0 text-blue-400" size={16} aria-hidden="true" />
        <p className="leading-snug">{t('backpressure.notice')}</p>
      </div>
    </div>
  );
};
