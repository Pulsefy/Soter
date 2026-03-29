'use client';

import Link from 'next/link';

interface ErrorStateProps {
  title: string;
  description: string;
  error?: Error & { digest?: string };
  onTryAgain?: () => void;
}

export function ErrorState({
  title,
  description,
  error,
  onTryAgain,
}: ErrorStateProps) {
  const showDetails = process.env.NODE_ENV !== 'production';

  return (
    <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-slate-950 px-4 py-16 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.28),transparent_42%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.18),transparent_35%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-position-[center_center] bg-size-[52px_52px] opacity-40" />

      <section className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-900/85 p-8 shadow-2xl shadow-cyan-950/30 backdrop-blur md:p-12">
        <div className="mb-8 inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-sm font-medium tracking-[0.2em] text-cyan-200 uppercase">
          Soter platform status
        </div>

        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">
            Resilient aid delivery
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white md:text-5xl">
            {title}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
            {description}
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          {onTryAgain ? (
            <button
              type="button"
              onClick={onTryAgain}
              className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Try again
            </button>
          ) : null}

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-cyan-300/60 hover:bg-white/5"
          >
            Back to Home
          </Link>
        </div>

        <div className="mt-10 grid gap-4 border-t border-white/10 pt-6 text-sm text-slate-300 md:grid-cols-2">
          <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
            <p className="font-semibold text-white">What happened</p>
            <p className="mt-2 leading-6 text-slate-300">
              The application hit an unexpected error while rendering this view.
              We keep the user-facing message generic so internal details stay
              private in production.
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
            <p className="font-semibold text-white">What you can do</p>
            <p className="mt-2 leading-6 text-slate-300">
              Retry the action or return to the home page to start a fresh
              session.
            </p>
          </div>
        </div>

        {showDetails && error ? (
          <div className="mt-8 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
            <p className="font-semibold text-amber-50">Development details</p>
            <p className="mt-2 wrap-break-word font-mono text-xs leading-6 text-amber-100/90">
              {error.message}
            </p>
            {error.digest ? (
              <p className="mt-1 font-mono text-xs leading-6 text-amber-100/90">
                Digest: {error.digest}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
