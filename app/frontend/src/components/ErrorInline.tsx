'use client';

import React from 'react';
import { 
  AlertTriangle, 
  WifiOff, 
  ServerCrash, 
  Wallet, 
  RefreshCcw,
  XCircle,
  HelpCircle
} from 'lucide-react';
import { ERROR_METADATA, ErrorCategory } from '@/types/error';
import { categorizeError } from '@/lib/error-utils';

interface ErrorInlineProps {
  error?: Error | string | null;
  category?: ErrorCategory;
  onRetry?: () => void;
  onClose?: () => void;
  variant?: 'banner' | 'card';
}

export function ErrorInline({
  error,
  category: manualCategory,
  onRetry,
  onClose,
  variant = 'card',
}: ErrorInlineProps) {
  if (!error) return null;

  const category = manualCategory || categorizeError(error);
  const metadata = ERROR_METADATA[category];
  
  const errorMessage = typeof error === 'string' ? error : error.message;

  const CategoryIcon = {
    wallet: Wallet,
    network: WifiOff,
    server: ServerCrash,
    unknown: AlertTriangle,
  }[category];

  if (variant === 'banner') {
    return (
      <div className={`relative flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition-all sm:flex-row sm:items-center sm:justify-between ${
        category === 'wallet' ? 'border-amber-400/20 bg-amber-400/5 text-amber-200' :
        category === 'network' ? 'border-cyan-400/20 bg-cyan-400/5 text-cyan-200' :
        category === 'server' ? 'border-rose-400/20 bg-rose-400/5 text-rose-200' :
        'border-slate-400/20 bg-slate-400/5 text-slate-200'
      }`}>
        <div className="flex items-start gap-3 sm:items-center">
          <CategoryIcon size={18} className="shrink-0 opacity-80" />
          <div className="space-y-1">
            <p className="text-sm font-semibold leading-none">{metadata.title}</p>
            <p className="text-xs opacity-70 leading-relaxed">{errorMessage}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {onRetry && metadata.canRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/20 active:scale-95"
            >
              <RefreshCcw size={14} />
              Retry
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 opacity-50 transition-opacity hover:opacity-100"
            >
              <XCircle size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-2xl border bg-slate-900/40 p-5 shadow-xl backdrop-blur-md ${
      category === 'wallet' ? 'border-amber-400/20' :
      category === 'network' ? 'border-cyan-400/20' :
      category === 'server' ? 'border-rose-400/20' :
      'border-slate-400/20'
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-br ${
          category === 'wallet' ? 'border-amber-400/30 from-amber-400/20 to-amber-400/5 text-amber-400' :
          category === 'network' ? 'border-cyan-400/30 from-cyan-400/20 to-cyan-400/5 text-cyan-400' :
          category === 'server' ? 'border-rose-400/30 from-rose-400/20 to-rose-400/5 text-rose-400' :
          'border-slate-400/30 from-slate-400/20 to-slate-400/5 text-slate-400'
        }`}>
          <CategoryIcon size={20} />
        </div>
        
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <XCircle size={18} />
          </button>
        )}
      </div>

      <div className="mt-4">
        <h3 className="font-semibold text-white">{metadata.title}</h3>
        <p className="mt-1 text-sm text-slate-400 leading-relaxed">
          {errorMessage || metadata.description}
        </p>
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-lg bg-white/5 p-3">
          <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
            <HelpCircle size={12} />
            <span>Try these steps</span>
          </div>
          <ul className="space-y-1.5">
            {metadata.hints.slice(0, 2).map((hint, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                <div className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                {hint}
              </li>
            ))}
          </ul>
        </div>

        {onRetry && metadata.canRetry && (
          <button
            onClick={onRetry}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition-all hover:bg-slate-200 active:scale-[0.98]"
          >
            <RefreshCcw size={16} />
            Retry Action
          </button>
        )}
      </div>
    </div>
  );
}
