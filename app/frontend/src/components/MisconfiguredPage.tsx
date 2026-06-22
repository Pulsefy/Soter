import { Settings2, Info } from 'lucide-react';

interface MisconfiguredPageProps {
  /** Variable labels that are completely absent */
  missing: string[];
  /** Variable labels that are present but have an invalid value */
  invalid: string[];
}

/**
 * Full-page error shown at startup when required environment variables are
 * missing or misconfigured.  Rendered server-side so it works even before the
 * React client bundle loads.
 *
 * Security note: only variable *names/labels* are shown here — no secret
 * values are ever rendered.
 */
export function MisconfiguredPage({ missing, invalid }: MisconfiguredPageProps) {
  const hints = [
    'Set NEXT_PUBLIC_API_URL to the full backend URL (e.g. https://api.soter.app)',
    'Set NEXT_PUBLIC_STELLAR_NETWORK to one of: testnet, mainnet, futurenet, standalone',
    'On Vercel: add the variables under Project → Settings → Environment Variables',
    'After updating variables, trigger a new deployment for changes to take effect',
  ];

  return (
    <html lang="en">
      <body>
        <main className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-slate-950 px-4 py-16 text-slate-100">
          {/* Ambient background */}
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-orange-500/10 blur-[120px]" />
            <div className="absolute -bottom-[10%] -right-[10%] h-[40%] w-[40%] rounded-full bg-amber-500/10 blur-[120px]" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
          </div>

          <section className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur-xl md:p-2">
            <div className="p-8 md:p-12">
              {/* Header */}
              <div className="mb-8 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-400/30 bg-gradient-to-br from-orange-400/20 to-orange-400/5 text-orange-400">
                  <Settings2 size={32} strokeWidth={1.5} />
                </div>

                <div className="space-y-1">
                  <div className="inline-flex items-center rounded-full bg-white/5 px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 border border-white/5">
                    config error detected
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                    Misconfigured deployment
                  </h1>
                </div>
              </div>

              <p className="text-lg leading-relaxed text-slate-300">
                Required environment variables are missing or have an invalid value.
                This deployment cannot start until the configuration is corrected.
              </p>

              {/* Affected variables */}
              {(missing.length > 0 || invalid.length > 0) && (
                <div className="mt-8 space-y-4">
                  {missing.length > 0 && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-300">
                        Missing variables
                      </p>
                      <ul className="space-y-1">
                        {missing.map((label) => (
                          <li
                            key={label}
                            className="font-mono text-sm text-rose-200/80"
                          >
                            — {label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {invalid.length > 0 && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-300">
                        Invalid variables
                      </p>
                      <ul className="space-y-1">
                        {invalid.map((label) => (
                          <li
                            key={label}
                            className="font-mono text-sm text-amber-200/80"
                          >
                            — {label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Recovery tips */}
              <div className="mt-10">
                <div className="rounded-2xl border border-white/5 bg-slate-950/40 p-6">
                  <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-emerald-400">
                    <Info size={16} />
                    <span>How to fix this</span>
                  </div>
                  <p className="mb-4 text-sm leading-relaxed text-slate-400">
                    Add the missing environment variables to your deployment platform and
                    redeploy the project.
                  </p>
                  <div className="space-y-3">
                    {hints.map((hint) => (
                      <div key={hint} className="flex items-start gap-3">
                        <div className="mt-1.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                        <span className="text-xs leading-relaxed text-slate-400">
                          {hint}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
