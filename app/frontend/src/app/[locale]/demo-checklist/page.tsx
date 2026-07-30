'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Globe,
  FileCode,
  Droplet,
  BarChart3,
  CheckSquare,
  Receipt,
  Trash2,
  Database,
  Download,
  Edit3,
  Shield,
  BookOpen,
  RefreshCw,
  Layers,
  Clock,
  Zap,
} from 'lucide-react';
import { useWalletStore } from '@/lib/walletStore';
import { useHealthStatus } from '@/hooks/useHealthStatus';
import { useContractRegistry } from '@/hooks/useContractRegistry';
import { useRunbook } from '@/hooks/useRunbook';
import { enableDemoChecklist } from '@/lib/env';
import { stellarNetwork } from '@/lib/env';
import type { ChecklistItem as RunbookChecklistItem } from '@/types/runbook';

/* ─── Icon lookup ───────────────────────────────────────────────────────── */

const ICON_MAP: Record<string, React.ElementType> = {
  Server,
  Wallet,
  Globe,
  FileCode,
  Droplet,
  Activity,
  Megaphone,
  FileText,
  CheckSquare,
  Receipt,
  BarChart3,
  Trash2,
  Database,
  Download,
  Edit3,
  Shield,
  Zap,
};

function resolveIcon(name: string): React.ElementType {
  return ICON_MAP[name] ?? Layers;
}

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ChecklistStep {
  id: string;
  titleKey: string;
  descriptionKey: string;
  href: string;
  linkLabelKey: string;
  icon: React.ElementType;
  isComplete: () => boolean;
}

type TabId = 'all' | 'pre' | 'live' | 'post';

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

/* ─── Contract Registry Card ─────────────────────────────────────────────── */

function ContractRegistryCard() {
  const t = useTranslations('demoChecklist');
  const { state, data, error } = useContractRegistry();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyId = async (id: string, contractId: string) => {
    try {
      await navigator.clipboard.writeText(contractId);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* ignore */
    }
  };

  if (state === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <div className="flex items-center gap-2">
          <FileCode size={18} className="text-slate-500 animate-pulse" />
          <h3 className="text-sm font-semibold">{t('registryTitle')}</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('registryLoading')}
        </p>
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 dark:border-red-900/50 dark:bg-red-950/20 space-y-2">
        <div className="flex items-center gap-2">
          <FileCode size={18} className="text-red-500" />
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
            {t('registryTitle')}
          </h3>
        </div>
        <p className="text-xs text-red-600 dark:text-red-400">
          {error?.message || t('registryError')}
        </p>
      </div>
    );
  }

  const severityColor: Record<string, string> = {
    low: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
    high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  };

  return (
    <div
      id="contract-registry"
      className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <FileCode size={16} className="text-slate-600 dark:text-slate-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t('registryTitle')}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed">
              {t('registrySubtitle')}
            </p>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-slate-500 dark:text-slate-400 font-medium">
          {t('registrySchemaVersion')}
        </dt>
        <dd className="font-mono text-slate-700 dark:text-slate-300">v{data.schema_version}</dd>
        <dt className="text-slate-500 dark:text-slate-400 font-medium">
          {t('registryGenerated')}
        </dt>
        <dd className="text-slate-700 dark:text-slate-300">
          {new Date(data.generated_at).toLocaleString()}
        </dd>
      </dl>

      <div className="space-y-3">
        {Object.entries(data.contracts).map(([name, entry]) => {
          const networks = Object.entries(entry.networks);
          return (
            <div
              key={name}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-blue-500" />
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 font-mono">
                    {name}
                  </span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-mono">
                  crate v{entry.version}
                </span>
              </div>

              {networks.length === 0 ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  {t('registryNoDeployments')}
                </p>
              ) : (
                <div className="space-y-2">
                  {networks.map(([network, dep]) => {
                    const rowId = `${name}-${network}`;
                    const isCopied = copiedId === rowId;
                    return (
                      <div
                        key={network}
                        className="rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${severityColor[network === 'testnet' ? 'medium' : 'low']}`}>
                            {network.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                            v{dep.version}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-[10px] font-mono text-slate-700 dark:text-slate-300 truncate" title={dep.contract_id}>
                            {dep.contract_id.slice(0, 10)}…{dep.contract_id.slice(-8)}
                          </code>
                          <button
                            onClick={() => copyId(rowId, dep.contract_id)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                            title={t('registryCopyId')}
                          >
                            {isCopied ? (
                              <Check size={12} className="text-green-500" />
                            ) : (
                              <Copy size={12} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
                            )}
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <Clock size={10} />
                          {dep.deployed_at}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
        {[
          { label: t('registrySourceCanonical'), value: data.source.canonical_path },
          { label: t('registrySourceGenerator'), value: data.source.generator_script },
          { label: t('registrySourceDeployment'), value: data.source.deployment_registry },
        ].map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-2 text-[11px]">
            <span className="text-slate-500 dark:text-slate-400 shrink-0">{row.label}</span>
            <code className="font-mono text-slate-700 dark:text-slate-300 text-right break-all">
              {row.value}
            </code>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end pt-1">
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
          <BookOpen size={11} />
          {t('registryViewSource')}
        </span>
      </div>
    </div>
  );
}

/* ─── Failure Recovery Panel ─────────────────────────────────────────────── */

function FailureRecoveryPanel() {
  const t = useTranslations('demoChecklist');
  const { data } = useRunbook();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyCmd = async (id: string, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(id);
      setTimeout(() => setCopiedCmd(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const issues = data?.failureRecovery?.issues ?? [];

  const severityConfig: Record<string, { badge: string; dot: string }> = {
    low: {
      badge: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
      dot: 'bg-green-500',
    },
    medium: {
      badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
      dot: 'bg-yellow-500',
    },
    high: {
      badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
      dot: 'bg-red-500',
    },
  };

  const severityLabel: Record<string, string> = {
    low: t('recoverySeverityLow'),
    medium: t('recoverySeverityMedium'),
    high: t('recoverySeverityHigh'),
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-50">
            <RefreshCw size={18} className="text-orange-500" />
            {t('recoveryTitle')}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {t('recoverySubtitle')}
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {issues.map((issue) => {
          const isOpen = !!expanded[issue.id];
          const cfg = severityConfig[issue.severity] ?? severityConfig.medium;
          return (
            <div
              key={issue.id}
              className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden transition-all"
            >
              <button
                onClick={() => toggle(issue.id)}
                className="w-full flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                aria-expanded={isOpen}
              >
                <span className={`h-2.5 w-2.5 rounded-full mt-1 shrink-0 ${cfg.dot}`} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${cfg.badge}`}>
                      {severityLabel[issue.severity] ?? issue.severity}
                    </span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                      {issue.id}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {t(issue.symptomKey)}
                  </p>
                </div>
                <div className="shrink-0 mt-0.5">
                  {isOpen ? (
                    <ChevronUp size={18} className="text-slate-400" />
                  ) : (
                    <ChevronDown size={18} className="text-slate-400" />
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-4 bg-slate-50/50 dark:bg-slate-950/30">
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                      {t('recoveryCause')}
                    </h4>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {t(issue.causeKey)}
                    </p>
                  </div>

                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                      {t('recoveryActions')}
                    </h4>
                    <ol className="space-y-2">
                      {issue.actions.map((action, idx) => (
                        <li key={action.id} className="flex gap-2.5 items-start">
                          <span className="flex items-center justify-center shrink-0 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 mt-0.5">
                            {idx + 1}
                          </span>
                          <div className="flex-1 space-y-1.5 min-w-0">
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              {action.description}
                            </p>
                            {action.command && (
                              <div className="flex items-center gap-2 rounded-md bg-slate-900 dark:bg-black/60 px-2.5 py-1.5 border border-slate-700">
                                <code className="flex-1 text-[11px] font-mono text-green-400 break-all">
                                  {action.command}
                                </code>
                                <button
                                  onClick={() => copyCmd(action.id, action.command!)}
                                  className="p-1 rounded hover:bg-slate-800 transition-colors shrink-0"
                                  title={t('recoveryCopyCommand')}
                                >
                                  {copiedCmd === action.id ? (
                                    <Check size={12} className="text-green-500" />
                                  ) : (
                                    <Copy size={12} className="text-slate-400 hover:text-slate-200" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {issue.relatedDocs && issue.relatedDocs.length > 0 && (
                    <div>
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                        {t('recoveryRelatedDocs')}
                      </h4>
                      <ul className="space-y-1">
                        {issue.relatedDocs.map((doc) => (
                          <li key={doc} className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                            {doc}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─── Section progress bar ───────────────────────────────────────────────── */

function SectionProgressBar({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label: string;
}) {
  const t = useTranslations('demoChecklist');
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px] font-medium text-slate-600 dark:text-slate-400">
        <span>{label}</span>
        <span>{t('progress', { completed, total })} · {pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Tabs ───────────────────────────────────────────────────────────────── */

function SectionTabs({
  active,
  onChange,
  counts,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
  counts: { pre: [number, number]; live: [number, number]; post: [number, number] };
}) {
  const t = useTranslations('demoChecklist');

  const tabs: { id: TabId; label: string; count?: [number, number] }[] = [
    { id: 'all', label: t('tabAllSteps') },
    { id: 'pre', label: t('tabPreDemo'), count: counts.pre },
    { id: 'live', label: t('tabLiveDemo'), count: counts.live },
    { id: 'post', label: t('tabPostDemo'), count: counts.post },
  ];

  return (
    <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isActive
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {tab.count[0]}/{tab.count[1]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Section card header ────────────────────────────────────────────────── */

function SectionHeader({
  title,
  subtitle,
  completed,
  total,
  icon: Icon,
  accent,
}: {
  title: string;
  subtitle: string;
  completed: number;
  total: number;
  icon: React.ElementType;
  accent: 'blue' | 'purple' | 'emerald';
}) {
  const accentBg = {
    blue: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400',
  }[accent];

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${accentBg}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 space-y-0.5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {subtitle}
          </p>
        </div>
      </div>
      <SectionProgressBar
        completed={completed}
        total={total}
        label=""
      />
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function DemoChecklistPage() {
  const router = useRouter();
  const t = useTranslations('demoChecklist');
  const { publicKey } = useWalletStore();
  const { state: healthState } = useHealthStatus();
  const runbook = useRunbook();
  const walletConnected = Boolean(publicKey);

  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('all');

  useEffect(() => {
    if (!enableDemoChecklist) {
      router.replace('/');
    } else {
      setAllowed(true);
    }
    setChecked(true);
  }, [router]);

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

  const isAutoComplete = (item: RunbookChecklistItem): boolean => {
    if (item.autoVerify === 'wallet') return walletConnected;
    if (item.autoVerify === 'health') return healthState === 'ok';
    return false;
  };

  const isStepDone = (item: RunbookChecklistItem): boolean => {
    if (isAutoComplete(item)) return true;
    return Boolean(checkedSteps[item.id]);
  };

  const runbookSections = useMemo(() => {
    const sb = runbook.data?.sections;
    return {
      pre: sb?.preDemo?.items ?? [],
      live: sb?.liveDemo?.items ?? [],
      post: sb?.postDemo?.items ?? [],
    };
  }, [runbook.data]);

  const sectionCounts = useMemo(() => {
    const count = (arr: RunbookChecklistItem[]) =>
      [arr.filter((i) => isStepDone(i)).length, arr.length] as [number, number];
    return {
      pre: count(runbookSections.pre),
      live: count(runbookSections.live),
      post: count(runbookSections.post),
    };
  }, [runbookSections, checkedSteps, walletConnected, healthState]);

  const totalSteps =
    sectionCounts.pre[1] + sectionCounts.live[1] + sectionCounts.post[1];
  const totalCompleted =
    sectionCounts.pre[0] + sectionCounts.live[0] + sectionCounts.post[0];
  const allComplete = totalSteps > 0 && totalCompleted === totalSteps;

  const legacySteps: ChecklistStep[] = [
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

  if (!checked) return null;
  if (!allowed) return null;

  const renderItemList = (items: RunbookChecklistItem[]) => (
    <ol className="space-y-3">
      {items.map((item, idx) => {
        const done = isStepDone(item);
        const auto = isAutoComplete(item);
        const Icon = resolveIcon(item.icon);
        return (
          <li
            key={item.id}
            className={`rounded-xl border bg-white p-4 transition-colors dark:bg-slate-900 ${
              done
                ? 'border-green-300 dark:border-green-800'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <div className="flex items-start gap-3.5">
              <button
                onClick={() => !auto && toggleStep(item.id)}
                disabled={auto}
                className={`mt-0.5 shrink-0 focus:outline-none ${auto ? 'cursor-default' : ''}`}
                aria-label={done ? `Mark incomplete` : `Mark complete`}
              >
                {done ? (
                  <CheckCircle2 size={22} className="text-green-500" />
                ) : (
                  <Circle size={22} className="text-slate-300 dark:text-slate-600" />
                )}
              </button>

              <div className="flex-1 space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon size={15} className="text-slate-400 shrink-0" />
                  <span className={`text-sm font-semibold ${done ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-50'}`}>
                    {idx + 1}. {t(item.titleKey)}
                  </span>
                  {auto && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium">
                      {t('autoVerified')}
                    </span>
                  )}
                  {!auto && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium">
                      {t('manual')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {t(item.descriptionKey)}
                </p>
                {item.href && item.linkLabelKey && (
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                  >
                    {t(item.linkLabelKey)}
                    <ExternalLink size={12} />
                  </Link>
                )}
              </div>

              <ArrowRight size={14} className="mt-1.5 shrink-0 text-slate-300 dark:text-slate-600" />
            </div>
          </li>
        );
      })}
    </ol>
  );

  const hasRunbookData = runbook.state === 'ready' && totalSteps > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-slate-50 px-4 py-10 dark:to-slate-950">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Testnet Review · Runbook
          </p>
          <h1 className="text-4xl font-semibold text-slate-900 dark:text-slate-50">
            {t('title')}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {t('subtitle')}
          </p>
        </div>

        {/* Overall progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
            <span>{t('progress', { completed: totalCompleted, total: totalSteps || legacySteps.length })}</span>
            <span>{Math.round(((totalCompleted) / (totalSteps || legacySteps.length)) * 100)}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{
                width: `${((totalCompleted) / (totalSteps || legacySteps.length)) * 100}%`,
              }}
            />
          </div>
          {allComplete && (
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {t('allComplete')}
            </p>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Main content */}
          <div className="space-y-8">
            {runbook.state === 'loading' && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
                <RefreshCw size={16} className="inline animate-spin mr-2" />
                {t('runbookLoading')}
              </div>
            )}

            {runbook.state === 'error' && !hasRunbookData && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-6 text-sm text-red-600 dark:text-red-400">
                {runbook.error?.message || t('runbookError')}
              </div>
            )}

            {hasRunbookData ? (
              <>
                <SectionTabs
                  active={activeTab}
                  onChange={setActiveTab}
                  counts={sectionCounts}
                />

                {(activeTab === 'all' || activeTab === 'pre') && (
                  <section className="space-y-4 pt-2">
                    <SectionHeader
                      title={t('preDemoTitle')}
                      subtitle={t('preDemoSubtitle')}
                      completed={sectionCounts.pre[0]}
                      total={sectionCounts.pre[1]}
                      icon={Zap}
                      accent="blue"
                    />
                    {renderItemList(runbookSections.pre)}
                  </section>
                )}

                {(activeTab === 'all' || activeTab === 'live') && (
                  <section className="space-y-4 pt-2">
                    <SectionHeader
                      title={t('liveDemoTitle')}
                      subtitle={t('liveDemoSubtitle')}
                      completed={sectionCounts.live[0]}
                      total={sectionCounts.live[1]}
                      icon={Activity}
                      accent="purple"
                    />
                    {renderItemList(runbookSections.live)}
                  </section>
                )}

                {(activeTab === 'all' || activeTab === 'post') && (
                  <section className="space-y-4 pt-2">
                    <SectionHeader
                      title={t('postDemoTitle')}
                      subtitle={t('postDemoSubtitle')}
                      completed={sectionCounts.post[0]}
                      total={sectionCounts.post[1]}
                      icon={CheckCircle2}
                      accent="emerald"
                    />
                    {renderItemList(runbookSections.post)}
                  </section>
                )}
              </>
            ) : (
              <ol className="space-y-4">
                {legacySteps.map((step, index) => {
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
            )}

            {/* Failure Recovery */}
            <FailureRecoveryPanel />
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <SystemHealthCard />
            <PrerequisitesCard walletConnected={walletConnected} />
            <ContractRegistryCard />

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
                <li>
                  <Link href="/campaigns" className="text-blue-600 hover:underline dark:text-blue-400">
                    {t('goCampaigns')}
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
