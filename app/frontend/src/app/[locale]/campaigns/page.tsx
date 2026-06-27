'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppEmptyState } from '@/components/empty-state/AppEmptyState';
import { ExportControls } from '@/components/dashboard/ExportControls';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';
import { useCampaigns, useCreateCampaign } from '@/hooks/useCampaigns';
import { useCampaignAction } from '@/hooks/useOptimisticCampaignMutations';
import { InlineFeedback, OptimisticStatusBadge } from '@/components/InlineFeedback';
import {
  canManageCampaigns,
  getUserRole,
  getUserRoleLabel,
} from '@/lib/user-role';
import type { CampaignStatus } from '@/types/campaign';

function toCampaignStatus(value: string): CampaignStatus | '' {
  const map: Record<string, CampaignStatus> = {
    Active: 'active',
    active: 'active',
    Expired: 'archived',
    archived: 'archived',
    Claimed: 'completed',
    completed: 'completed',
    paused: 'paused',
    draft: 'draft',
  };
  return map[value] ?? '';
}

export default function CampaignsPage() {
  const searchParams = useSearchParams();
  const urlStatus = searchParams.get('status') ?? '';
  const userRole = getUserRole();
  const userRoleLabel = getUserRoleLabel(userRole);
  const { data: campaigns = [], isLoading, isError, error } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const campaignAction = useCampaignAction();

  const { isMismatch, expectedNetwork } = useNetworkGuard();

  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [token, setToken] = useState('USDC');
  const [expiry, setExpiry] = useState('');
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const activeCampaignStatus = toCampaignStatus(urlStatus);

  const activeCampaigns = useMemo(
    () =>
      campaigns.filter(campaign => {
        if (campaign.status === 'archived') return false;
        if (activeCampaignStatus) return campaign.status === activeCampaignStatus;
        return true;
      }),
    [campaigns, activeCampaignStatus],
  );

  const loadSampleCampaign = () => {
    setName('Sample Emergency Cash Transfer');
    setBudget('15000');
    setToken('USDC');
    setExpiry('2026-12-31');
    setFormMessage('Sample campaign values loaded. Review and create when ready.');
  };

  if (!canManageCampaigns(userRole)) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-900">
        <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 dark:border-red-800 dark:bg-gray-800">
          <h1 className="text-2xl font-semibold text-red-600">Access Denied</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
            This page is reserved for NGO and Admin roles. Your role is{' '}
            <strong>{userRoleLabel}</strong>.
          </p>
        </div>
      </div>
    );
  }

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isMismatch) {
      setFormMessage(`Cannot create campaign: wallet is on the wrong network. Switch to ${expectedNetwork.toUpperCase()} in Freighter.`);
      return;
    }
    if (!name.trim() || !budget.trim()) {
      setFormMessage('Name and budget are required.');
      return;
    }

    const payload = {
      name: name.trim(),
      budget: Number(budget),
      status: 'active' as CampaignStatus,
      metadata: {
        token: token.trim(),
        expiry: expiry ? new Date(expiry).toISOString() : undefined,
      },
    };

    try {
      await createCampaign.mutateAsync(payload);
      setName('');
      setBudget('');
      setToken('USDC');
      setExpiry('');
      setFormMessage('Campaign created successfully.');
    } catch (err) {
      setFormMessage((err as Error).message ?? 'Failed to create campaign.');
    }
  };

  const onPauseResume = async (id: string, campaignName: string, currentStatus: CampaignStatus) => {
    if (isMismatch) return;
    const action = currentStatus === 'active' 
      ? { type: 'pause' as const, targetStatus: 'paused' as const }
      : { type: 'resume' as const, targetStatus: 'active' as const };
    
    campaignAction.mutate({ id, campaignName, action });
  };

  const onArchive = async (id: string, campaignName: string) => {
    if (isMismatch) return;
    campaignAction.mutate({ 
      id, 
      campaignName, 
      action: { type: 'archive' as const, targetStatus: 'archived' as const } 
    });
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-gray-50 p-6 dark:to-gray-950">
      <main className="container mx-auto space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-4xl font-bold">NGO Campaigns</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">Role: {userRoleLabel}</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 text-xl font-semibold">Create New Campaign</h2>
            {formMessage && (
              <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {formMessage}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-3">
              <label className="block">
                <span className="font-medium">Name</span>
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder="e.g. Winter Relief 2026"
                  required
                />
              </label>

              <label className="block">
                <span className="font-medium">Budget (USD)</span>
                <input
                  type="number"
                  min="0"
                  value={budget}
                  onChange={event => setBudget(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder="e.g. 25000"
                  required
                />
              </label>

              <label className="block">
                <span className="font-medium">Token</span>
                <input
                  value={token}
                  onChange={event => setToken(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder="e.g. USDC"
                />
              </label>

              <label className="block">
                <span className="font-medium">Expiry date</span>
                <input
                  type="date"
                  value={expiry}
                  onChange={event => setExpiry(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                />
              </label>

              <button
                type="submit"
                disabled={createCampaign.isPending || isMismatch}
                title={isMismatch ? `Wrong network — switch to ${expectedNetwork.toUpperCase()} in Freighter` : undefined}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createCampaign.isPending ? 'Creating...' : 'Create campaign'}
              </button>
              <button
                type="button"
                onClick={loadSampleCampaign}
                className="ml-2 inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Load sample values
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Active Campaigns</h2>
              <ExportControls context="Campaigns" filters={{ activeOnly: true }} />
            </div>

            {isLoading && <p>Loading campaigns...</p>}
            {isError && (
              <p className="text-red-500">
                Error fetching campaigns: {(error as Error)?.message}
              </p>
            )}
            {!isLoading && !isError && campaigns.length === 0 && (
              <AppEmptyState
                compact
                eyebrow="No Campaigns Yet"
                title="There are no active campaigns to review"
                description="New contributors should still have a clear starting point here. Create a sample campaign, then use recipient import to explore the onboarding workflow."
                tips={[
                  'Load sample values in the form to generate realistic test content quickly.',
                  'Open Help for contributor setup notes, including mock mode and role-aware paths.',
                ]}
                actions={[
                  { onClick: loadSampleCampaign, label: 'Load sample campaign', icon: 'sample' },
                  { href: '/help', label: 'View help', icon: 'docs', variant: 'secondary' },
                ]}
              />
            )}
            {!isLoading && !isError && campaigns.length > 0 && activeCampaigns.length === 0 && (
              <p className="text-gray-500">No campaigns match the current filter.</p>
            )}

            {!isLoading && !isError && activeCampaigns.length > 0 && (
              <div className="space-y-3">
                {activeCampaigns.map(campaign => (
                  <div
                    key={campaign.id}
                    className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold">{campaign.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Budget:{' '}
                          {campaign.budget.toLocaleString('en-US', {
                            style: 'currency',
                            currency: 'USD',
                          })}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Token: {campaign.metadata?.token ?? 'N/A'}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Expiry:{' '}
                          {campaign.metadata?.expiry
                            ? new Date(campaign.metadata.expiry as string).toLocaleDateString()
                            : 'N/A'}
                        </p>
                      </div>
                      <OptimisticStatusBadge
                        status={campaign.status}
                        isOptimistic={campaignAction.isPending && campaignAction.variables?.id === campaign.id}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/campaigns/${campaign.id}/import-recipients`}
                        className="rounded-md border border-blue-300 px-3 py-1 text-sm text-blue-700 transition hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/30"
                      >
                        Import recipients
                      </Link>
                      {campaignAction.isPending && campaignAction.variables?.id === campaign.id ? (
                        <InlineFeedback
                          isPending={true}
                          action={
                            campaignAction.variables?.action.type === 'pause'
                              ? 'pausing'
                              : campaignAction.variables?.action.type === 'resume'
                                ? 'resuming'
                                : 'archiving'
                          }
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onPauseResume(campaign.id, campaign.name, campaign.status)}
                            disabled={campaignAction.isPending || isMismatch}
                            title={isMismatch ? `Wrong network — switch to ${expectedNetwork.toUpperCase()} in Freighter` : undefined}
                            className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            {campaign.status === 'active' ? 'Pause' : 'Resume'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onArchive(campaign.id, campaign.name)}
                            disabled={campaignAction.isPending || isMismatch || campaign.status === 'archived'}
                            title={isMismatch ? `Wrong network — switch to ${expectedNetwork.toUpperCase()} in Freighter` : undefined}
                            className="rounded-md border border-red-400 px-3 py-1 text-sm text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/20"
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
