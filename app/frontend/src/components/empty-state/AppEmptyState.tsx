'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, LifeBuoy, Sparkles } from 'lucide-react';

interface AppEmptyStateAction {
  href?: string;
  onClick?: () => void;
  label: string;
  icon?: 'sample' | 'docs' | 'next';
  variant?: 'primary' | 'secondary';
}

interface AppEmptyStateProps {
  eyebrow?: string;
  title: string;
  description: string;
  tips?: string[];
  actions?: AppEmptyStateAction[];
  compact?: boolean;
}

function ActionIcon({ icon }: { icon?: AppEmptyStateAction['icon'] }) {
  if (icon === 'sample') return <Sparkles className="h-4 w-4" />;
  if (icon === 'docs') return <BookOpen className="h-4 w-4" />;
  if (icon === 'next') return <ArrowRight className="h-4 w-4" />;
  return <LifeBuoy className="h-4 w-4" />;
}

export function AppEmptyState({
  eyebrow,
  title,
  description,
  tips = [],
  actions = [],
  compact = false,
}: AppEmptyStateProps) {
  return (
    <div
      className={`rounded-xl border border-dashed border-slate-300 bg-slate-50 ${
        compact ? 'p-5' : 'p-8'
      } dark:border-slate-700 dark:bg-slate-950`}
    >
      <div className="max-w-3xl space-y-4">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {eyebrow}
          </p>
        ) : null}

        <div className="space-y-2">
          <h3 className={`${compact ? 'text-lg' : 'text-2xl'} font-semibold text-slate-900 dark:text-slate-50`}>
            {title}
          </h3>
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
        </div>

        {tips.length > 0 ? (
          <div className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
            {tips.map(tip => (
              <p key={tip}>{tip}</p>
            ))}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-3 pt-1">
            {actions.map(action => {
              const className =
                action.variant === 'secondary'
                  ? 'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  : 'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700';

              if (action.href) {
                return (
                  <Link key={`${action.label}-${action.href}`} href={action.href} className={className}>
                    <ActionIcon icon={action.icon} />
                    {action.label}
                  </Link>
                );
              }

              return (
                <button key={action.label} type="button" onClick={action.onClick} className={className}>
                  <ActionIcon icon={action.icon} />
                  {action.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
