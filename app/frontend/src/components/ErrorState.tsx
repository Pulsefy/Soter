'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  AlertTriangle, 
  ArrowLeft,
  WifiOff, 
  ServerCrash, 
  Wallet, 
  RefreshCcw, 
  Home, 
  ChevronRight,
  Info,
  Settings2
} from 'lucide-react';
import { ERROR_METADATA, ErrorCategory } from '@/types/error';
import { isRetrySafe, normalizeError } from '@/lib/error-utils';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  error?: (Error & {
    digest?: string;
    correlationId?: string;
    traceId?: string;
    status?: number;
    code?: string;
    canRetry?: boolean;
  }) | null;
  onTryAgain?: () => void;
  onGoBack?: () => void;
  onNavigate?: () => void;
  correlationId?: string;
  canRetry?: boolean;
  category?: ErrorCategory;
}

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function ErrorState({
  title: manualTitle,
  description: manualDescription,
  error,
  onTryAgain,
  onGoBack,
  onNavigate,
  correlationId: manualCorrelationId,
  canRetry: manualCanRetry,
  category: manualCategory,
}: ErrorStateProps) {
  const router = useSafeRouter();
  const normalized = normalizeError(error);
  const category = manualCategory || (error ? normalized.category : 'unknown');
  const metadata = ERROR_METADATA[category];
  
  const title = manualTitle || metadata.title;
  const description = manualDescription || metadata.description;
  const correlationId = manualCorrelationId || normalized.correlationId;
  const canRetry =
    manualCanRetry !== undefined
      ? manualCanRetry && metadata.canRetry
      : metadata.canRetry && isRetrySafe(error, category);
  const showDetails = process.env.NODE_ENV !== 'production';

  const handleGoBack = () => {
    onNavigate?.();

    if (onGoBack) {
      onGoBack();
      return;
    }

    const canUseHistoryBack =
      typeof window !== 'undefined' && window.history.length > 1;

    if (canUseHistoryBack) {
      if (router?.back) {
        router.back();
      } else {
        window.history.back();
      }
      return;
    }

    if (router?.push) {
      router.push('/');
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

          {correlationId && (
            <div
              data-testid="error-correlation-id"
              className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-xs text-slate-300"
            >
              <span className="text-slate-400">Correlation ID:</span>
              <code className="font-mono text-cyan-300">{correlationId}</code>
            </div>
          )}

          {/* Action Zone */}
          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
            {onTryAgain && canRetry && (
              <button
                type="button"
                onClick={onTryAgain}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition-all hover:bg-slate-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                <RefreshCcw size={18} className="transition-transform group-hover:rotate-180 duration-700" />
                Retry action
              </button>
            )}

            <button
              type="button"
              onClick={handleGoBack}
              className="group inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/10 hover:border-white/20"
            >
              <ArrowLeft size={18} className="transition-transform group-hover:-translate-x-0.5" />
              Go back
            </button>

            <Link
              href="/"
              onClick={() => onNavigate?.()}
              className="group inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/10 hover:border-white/20"
            >
              <Home size={18} />
              Return Home
            </Link>
          </div>

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
        </div>
      </section>

      {/* Footer Support Hub */}
      <div className="absolute bottom-8 left-0 right-0 z-10 flex justify-center px-4">
        <Link 
          href="/help"
          onClick={() => onNavigate?.()}
          className="group flex items-center gap-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300"
        >
          Need help? Visit the Guide
          <ChevronRight size={14} className="transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </main>
  );
}
