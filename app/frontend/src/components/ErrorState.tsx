'use client';

import Link from 'next/link';
import { 
  AlertTriangle, 
  WifiOff, 
  ServerCrash, 
  Wallet, 
  RefreshCcw, 
  Home, 
  ChevronRight,
  Info,
  Settings2,
  ArrowLeft,
  Copy,
  Check
} from 'lucide-react';
import { useState } from 'react';
import { ERROR_METADATA, ErrorCategory } from '@/types/error';
import { categorizeError, normalizeError } from '@/lib/error-utils';

interface ErrorStateProps {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  onTryAgain?: () => void;
  category?: ErrorCategory;
  retryCount?: number;
  maxRetries?: number;
}

export function ErrorState({
  title: manualTitle,
  description: manualDescription,
  error,
  onTryAgain,
  category: manualCategory,
  retryCount = 0,
  maxRetries = 3,
}: ErrorStateProps) {
  const category = manualCategory || categorizeError(error);
  const metadata = ERROR_METADATA[category];
  
  const title = manualTitle || metadata.title;
  const description = manualDescription || metadata.description;
  const showDetails = process.env.NODE_ENV !== 'production';
  const [copied, setCopied] = useState(false);

  // Extract correlation ID from the error if it's a NormalizedError or ApiError
  const normalized = error ? normalizeError(error) : null;
  const correlationId = normalized?.correlationId || (error as any)?.correlationId || (error as any)?.traceId;
  const retryExhausted = retryCount >= maxRetries;

  const handleGoBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  };

  const handleCopyCorrelationId = async () => {
    if (correlationId) {
      await navigator.clipboard.writeText(correlationId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const CategoryIcon = {
    wallet: Wallet,
    network: WifiOff,
    server: ServerCrash,
    config: Settings2,
    unknown: AlertTriangle,
  }[category];

  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-slate-950 px-4 py-16 text-slate-100">
      {/* Dynamic Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] h-[40%] w-[40%] rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <section className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur-xl md:p-2">
        <div className="p-8 md:p-12">
          {/* Header Section */}
          <div className="mb-8 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border bg-gradient-to-br ${
              category === 'wallet' ? 'border-amber-400/30 from-amber-400/20 to-amber-400/5 text-amber-400' :
              category === 'network' ? 'border-cyan-400/30 from-cyan-400/20 to-cyan-400/5 text-cyan-400' :
              category === 'server' ? 'border-rose-400/30 from-rose-400/20 to-rose-400/5 text-rose-400' :
              category === 'config' ? 'border-orange-400/30 from-orange-400/20 to-orange-400/5 text-orange-400' :
              'border-slate-400/30 from-slate-400/20 to-slate-400/5 text-slate-400'
            }`}>
              <CategoryIcon size={32} strokeWidth={1.5} />
            </div>
            
            <div className="space-y-1">
              <div className="inline-flex items-center rounded-full bg-white/5 px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 border border-white/5">
                {category} error detected
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                {title}
              </h1>
            </div>
          </div>

          <p className="text-lg leading-relaxed text-slate-300">
            {description}
          </p>

          {/* Action Zone */}
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            {onTryAgain && metadata.canRetry && (
              <button
                type="button"
                onClick={retryExhausted ? undefined : onTryAgain}
                disabled={retryExhausted}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition-all hover:bg-slate-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                <RefreshCcw size={18} className={`transition-transform duration-700 ${retryExhausted ? '' : 'group-hover:rotate-180'}`} />
                {retryExhausted ? 'Retry limit reached' : 'Retry action'}
              </button>
            )}

            <button
              type="button"
              onClick={handleGoBack}
              className="group inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/10 hover:border-white/20"
            >
              <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-0.5" />
              Go Back
            </button>

            <Link
              href="/"
              className="group inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/10 hover:border-white/20"
            >
              <Home size={18} />
              Return Home
            </Link>
          </div>

          {retryCount > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              {retryExhausted
                ? `Retry limit reached (${retryCount}/${maxRetries}). Please try again later or contact support.`
                : `Retried ${retryCount} time${retryCount > 1 ? 's' : ''} so far.`}
            </p>
          )}

          {/* Recovery Tips */}
          <div className="mt-12 space-y-6">
            <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-6">
              <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-emerald-400">
                <Info size={16} />
                <span>Recommended Recovery</span>
              </div>
              <p className="text-sm leading-relaxed text-slate-400">
                {metadata.remediation}
              </p>
              
              <div className="mt-6 space-y-3">
                {metadata.hints.map((hint, i) => (
                  <div key={i} className="flex items-start gap-3 group">
                    <div className="mt-1.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400 transition-transform group-hover:scale-150" />
                    <span className="text-xs leading-relaxed text-slate-400 group-hover:text-slate-200 transition-colors">
                      {hint}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Technical Details (Dev Only) */}
          {showDetails && error && (
            <div className="mt-8 overflow-hidden rounded-xl border border-rose-500/20 bg-rose-500/5">
              <div className="flex items-center justify-between border-b border-rose-500/20 bg-rose-500/10 px-4 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300">
                  Developer Context
                </span>
                {error.digest && (
                  <span className="text-[10px] font-mono text-rose-400/60">
                    ID: {error.digest}
                  </span>
                )}
              </div>
              <div className="p-4">
                <code className="block whitespace-pre-wrap font-mono text-xs text-rose-200/80">
                  {error.stack || error.message}
                </code>
              </div>
            </div>
          )}

          {/* Correlation ID (shown in all environments when available) */}
          {correlationId && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Correlation ID
                </span>
                <span className="font-mono text-xs text-slate-400">{correlationId}</span>
              </div>
              <button
                type="button"
                onClick={handleCopyCorrelationId}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
                aria-label="Copy correlation ID"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Footer Support Hub */}
      <div className="absolute bottom-8 left-0 right-0 z-10 flex justify-center px-4">
        <Link 
          href="/help"
          className="group flex items-center gap-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300"
        >
          Need help? Visit the Guide
          <ChevronRight size={14} className="transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </main>
  );
}

