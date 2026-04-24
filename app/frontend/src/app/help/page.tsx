import Link from 'next/link';
import { getAppUserRole, getRoleAwareHelpCopy, getRoleLabel, isOperationsRole } from '@/lib/app-role';

export default function HelpPage() {
  const role = getAppUserRole();

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-slate-50 px-4 py-10 dark:to-slate-950">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Contributor Guide
          </p>
          <h1 className="text-4xl font-semibold text-slate-900 dark:text-slate-50">Explore the app without live data</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Role: <span className="font-medium text-slate-900 dark:text-slate-100">{getRoleLabel(role)}</span>. {getRoleAwareHelpCopy(role)}
          </p>
        </div>

        <section className="grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Dashboard</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Check package cards, filters, exports, and the map view. In mock mode, these views populate without a live backend.
            </p>
            <Link href="/dashboard" className="mt-4 inline-flex text-sm font-medium text-blue-600 hover:text-blue-700">
              Open dashboard
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Campaigns</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Create a campaign manually or load sample values to explore import and review flows end to end.
            </p>
            <Link href="/campaigns" className="mt-4 inline-flex text-sm font-medium text-blue-600 hover:text-blue-700">
              Open campaigns
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold">Verification</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Use sample evidence text or upload a small test image to see the verification wizard states and error handling.
            </p>
            <Link href="/" className="mt-4 inline-flex text-sm font-medium text-blue-600 hover:text-blue-700">
              Open verification entry
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xl font-semibold">Suggested setup</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>`NEXT_PUBLIC_USE_MOCKS=true` gives the frontend predictable sample responses when backend services are missing.</p>
            <p>`NEXT_PUBLIC_USER_ROLE` changes the guidance contributors see in empty states, so you can review admin and recipient paths separately.</p>
            {isOperationsRole(role) ? (
              <p>For operations reviews, start in campaigns, create a sample campaign, then open recipient import for the full onboarding path.</p>
            ) : (
              <p>For recipient-style reviews, start with verification and dashboard pages to see request submission and package discovery without admin setup.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
