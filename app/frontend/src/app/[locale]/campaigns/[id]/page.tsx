'use client';

import Link from 'next/link';
import { use } from 'react';
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2 } from 'lucide-react';
import { useCampaign, useCampaignTimeline } from '@/hooks/useCampaigns';
import type { CampaignTimelineMilestone } from '@/types/campaign';

const statusStyles: Record<CampaignTimelineMilestone['status'], string> = {
  completed: 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200',
  pending: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
  delayed: 'border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200',
  failed: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200',
};

function TimelineIcon({ status }: { status: CampaignTimelineMilestone['status'] }) {
  if (status === 'completed') return <CheckCircle2 size={18} aria-hidden="true" />;
  if (status === 'failed') return <AlertCircle size={18} aria-hidden="true" />;
  if (status === 'delayed') return <Loader2 size={18} aria-hidden="true" className="animate-spin" />;
  return <Clock size={18} aria-hidden="true" />;
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const campaignQuery = useCampaign(id);
  const timelineQuery = useCampaignTimeline(id);

  const campaign = campaignQuery.data;
  const timeline = timelineQuery.data ?? [];

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-gray-50 p-6 dark:to-gray-950">
      <main className="container mx-auto max-w-5xl space-y-6">
        <Link href="/campaigns" className="text-sm text-blue-700 hover:underline dark:text-blue-300">
          Back to campaigns
        </Link>

        {campaignQuery.isLoading ? (
          <p className="text-slate-600 dark:text-slate-300">Loading campaign...</p>
        ) : campaignQuery.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            {(campaignQuery.error as Error).message}
          </div>
        ) : campaign ? (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold">{campaign.name}</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Campaign ID: <span className="font-mono">{campaign.id}</span>
                  </p>
                </div>
                <span className="rounded-full border border-slate-300 px-3 py-1 text-sm capitalize dark:border-slate-700">
                  {campaign.status}
                </span>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Budget</p>
                  <p className="text-lg font-semibold">
                    {campaign.budget.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Token</p>
                  <p className="text-lg font-semibold">{campaign.metadata?.token ?? 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-500 dark:text-slate-400">Expiry</p>
                  <p className="text-lg font-semibold">
                    {campaign.metadata?.expiry
                      ? new Date(campaign.metadata.expiry as string).toLocaleDateString()
                      : 'N/A'}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Onchain Milestones</h2>
                <Link
                  href={`/campaigns/${campaign.id}/import-recipients`}
                  className="rounded-md border border-blue-300 px-3 py-1 text-sm text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/30"
                >
                  Import recipients
                </Link>
              </div>

              {timelineQuery.isLoading && <p className="text-slate-500">Loading timeline...</p>}
              {timelineQuery.isError && (
                <p className="text-red-600 dark:text-red-300">{(timelineQuery.error as Error).message}</p>
              )}
              {!timelineQuery.isLoading && !timelineQuery.isError && timeline.length === 0 && (
                <p className="text-slate-500">No milestone data has been recorded yet.</p>
              )}
              <ol className="space-y-3">
                {timeline.map(milestone => (
                  <li key={milestone.id} className={`rounded-lg border p-4 ${statusStyles[milestone.status]}`}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5"><TimelineIcon status={milestone.status} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold">{milestone.label}</h3>
                          <span className="text-xs font-medium uppercase">{milestone.status}</span>
                        </div>
                        <p className="mt-1 text-sm">{milestone.description}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                          <span>
                            {milestone.occurredAt
                              ? new Date(milestone.occurredAt).toLocaleString()
                              : 'Timestamp pending'}
                          </span>
                          {milestone.correlationId && (
                            <span className="font-mono">correlation: {milestone.correlationId}</span>
                          )}
                          {milestone.explorerUrl && (
                            <a
                              href={milestone.explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline dark:text-blue-300"
                            >
                              Explorer <ExternalLink size={12} aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
