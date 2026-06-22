'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Wallet,
  Megaphone,
  FileText,
  CheckCircle2,
  Circle,
  ExternalLink,
  Activity,
  ArrowRight,
  AlertTriangle,
  Server,
} from 'lucide-react';
import { useWalletStore } from '@/lib/walletStore';
import { useHealthStatus } from '@/hooks/useHealthStatus';
import { enableDemoChecklist } from '@/lib/env';
import { stellarNetwork } from '@/lib/env';

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ChecklistStep {
  id: string;
  titleKey: string;
  descriptionKey: string;
  href: string;
  linkLabelKey: string;
  icon: React.ElementType;
  /** Return true when this step is complete. */
  isComplete: () => boolean;
}

/* ─── System health card ─────────────────────────────────────────────────── */

function SystemHealthCard() {
  const t = useTranslations('demoChecklist');
  const { state, data, error, lastChecked } = useHealthStatus();

  const stateColor = {
    ok: 'text-green-500',
    degraded: 'text-yellow-500',
    down: 'text-red-500',
    loading: 'text-gray-400 animate-pulse',
  }[state];

  const stateLabel = {
    ok: t('healthOk'),
    degraded: t('healthDegraded'),
    down: t('healthDown'),
    loading: t('healthChecking'),
  }[state];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
      <div className="flex items-center gap-2">
        <Server size={18} className="text-slate-500" />
        <h3 className="text-sm font-semibold">{t('systemHealth')}</h3>
      </div>

      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full bg-current ${stateColor} shrink-0`} />
        <span className="text-sm font-medium">{stateLabel}</span>
      </div>

      {data && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          <dt className="font-medium">Service</dt>
          <dd>{data.service ?? '—'}</dd>
          <dt className="font-medium">Version</dt>
          <dd>{data.version ?? '—'}</dd>
          <dt className="font-medium">Environment</dt>
          <dd>{data.environment ?? '—'}</dd>
        </dl>
      )}

      {error && (
        <p className="text-xs text-red-500">{error.message || t('healthDown')}</p>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t('lastChecked')}: {lastChecked ? lastChecked.toLocaleTimeString() : '—'}
      </p>

      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>Stellar:</span>
        <span className="font-mono">{stellarNetwork}</span>
      </div>
    </div>
  );
}

/* ─── Prerequisites card ─────────────────────────────────────────────────── */

function PrerequisitesCard({ walletConnected }: { walletConnected: boolean }) {
  const t = useTranslations('demoChecklist');
  const { state: healthState } = useHealthStatus();

  const items = [
    {
      label: t('prereqFreighter'),
      ok: typeof window !== 'undefined' && 'FreighterApi' in window,
    },
    { label: t('prereqWallet'), ok: walletConnected },
    { label: t('prereqBackend'), ok: healthState === 'ok' },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
      <h3 className="text-sm font-semibold">{t('prerequisites')}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2 text-sm">
            {item.ok ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-500" />
            ) : (
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-yellow-500" />
            )}
            <span className={item.ok ? '' : 'text-slate-500 dark:text-slate-400'}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function DemoChecklistPage() {
  const router = useRouter();
  const t = useTranslations('demoChecklist');
  const { publicKey } = useWalletStore();
  const walletConnected = Boolean(publicKey);

  // Feature-flag guard: redirect away when the flag is off
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!enableDemoChecklist) {
      router.replace('/');
    } else {
      setAllowed(true);
    }
    setChecked(true);
  }, [router]);

  // Persist checked state in localStorage so reviewers can track progress
  const STORAGE_KEY = 'soter-demo-checklist';

  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCheckedSteps(JSON.parse(stored));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleStep = (id: string) => {
    setCheckedSteps((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const steps: ChecklistStep[] = [
    {
      id: 'connect-wallet',
      titleKey: 'stepConnectWallet',
      descriptionKey: 'stepConnectWalletDesc',
      href: '/',
      linkLabelKey: 'goHome',
      icon: Wallet,
      isComplete: () => walletConnected,
    },
    {
      id: 'view-campaign',
      titleKey: 'stepViewCampaign',
      descriptionKey: 'stepViewCampaignDesc',
      href: '/campaigns',
      linkLabelKey: 'goCampaigns',
      icon: Megaphone,
      isComplete: () => Boolean(checkedSteps['view-campaign']),
    },
    {
      id: 'submit-claim',
      titleKey: 'stepSubmitClaim',
      descriptionKey: 'stepSubmitClaimDesc',
      href: '/claim-receipt?claimId=demo-test',
      linkLabelKey: 'goClaimReceipt',
      icon: FileText,
      isComplete: () => Boolean(checkedSteps['submit-claim']),
    },
    {
      id: 'verify-receipt',
      titleKey: 'stepVerifyReceipt',
      descriptionKey: 'stepVerifyReceiptDesc',
      href: '/claim-receipt?claimId=demo-verify',
      linkLabelKey: 'goClaimReceipt',
      icon: CheckCircle2,
      isComplete: () => Boolean(checkedSteps['verify-receipt']),
    },
  ];

  const completedCount = steps.filter((s) => s.isComplete()).length;
  const allComplete = completedCount === steps.length;

  if (!checked) return null;

  if (!allowed) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-slate-50 px-4 py-10 dark:to-slate-950">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Testnet Review
          </p>
          <h1 className="text-4xl font-semibold text-slate-900 dark:text-slate-50">
            {t('title')}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t('subtitle')}
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
            <span>{t('progress', { completed: completedCount, total: steps.length })}</span>
            <span>{Math.round((completedCount / steps.length) * 100)}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-2 rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>
          {allComplete && (
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {t('allComplete')}
            </p>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Checklist steps */}
          <ol className="space-y-4">
            {steps.map((step, index) => {
              const complete = step.isComplete();
              const Icon = step.icon;
              return (
                <li
                  key={step.id}
                  className={`rounded-xl border bg-white p-5 transition-colors dark:bg-slate-900 ${
                    complete
                      ? 'border-green-300 dark:border-green-800'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Step number / check icon */}
                    <button
                      onClick={() => toggleStep(step.id)}
                      className="mt-0.5 shrink-0 focus:outline-none"
                      aria-label={complete ? `Mark step ${index + 1} incomplete` : `Mark step ${index + 1} complete`}
                    >
                      {complete ? (
                        <CheckCircle2 size={24} className="text-green-500" />
                      ) : (
                        <Circle size={24} className="text-slate-300 dark:text-slate-600" />
                      )}
                    </button>

                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Icon size={16} className="text-slate-400 shrink-0" />
                        <span className={`text-sm font-semibold ${complete ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-50'}`}>
                          {index + 1}. {t(step.titleKey)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        {t(step.descriptionKey)}
                      </p>
                      <Link
                        href={step.href}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        {t(step.linkLabelKey)}
                        <ExternalLink size={12} />
                      </Link>
                    </div>

                    <ArrowRight size={16} className="mt-1 shrink-0 text-slate-300 dark:text-slate-600" />
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Sidebar */}
          <aside className="space-y-4">
            <SystemHealthCard />
            <PrerequisitesCard walletConnected={walletConnected} />

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Activity size={14} className="text-slate-400" />
                {t('quickLinks')}
              </h3>
              <ul className="space-y-1.5 text-sm">
                <li>
                  <Link href="/help" className="text-blue-600 hover:underline dark:text-blue-400">
                    {t('helpPage')}
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="text-blue-600 hover:underline dark:text-blue-400">
                    {t('dashboardPage')}
                  </Link>
                </li>
                <li>
                  <Link href="/verification-review" className="text-blue-600 hover:underline dark:text-blue-400">
                    {t('verificationReviewPage')}
                  </Link>
                </li>
              </ul>
            </div>

            <button
              onClick={() => {
                setCheckedSteps({});
                try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
            >
              {t('resetChecklist')}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
