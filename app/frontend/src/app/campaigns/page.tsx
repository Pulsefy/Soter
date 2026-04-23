'use client';

import { useMemo, useState } from 'react';
import { ExportControls } from '@/components/dashboard/ExportControls';
import { useCampaigns, useCreateCampaign, useUpdateCampaign, useArchiveCampaign } from '@/hooks/useCampaigns';
import { useToast } from '@/components/ToastProvider';
import {
  canManageCampaigns,
  getUserRole,
  getUserRoleLabel,
} from '@/lib/user-role';
import type { Campaign, CampaignStatus } from '@/types/campaign';

const statusStyles: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
  archived: 'bg-red-100 text-red-800',
};

/** Map AidPackageFilters status values to CampaignStatus (best-effort). */
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
  const userRole = getUserRole();
  const userRoleLabel = getUserRoleLabel(userRole);
  const { data: campaigns = [], isLoading, isError, error } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const archiveCampaign = useArchiveCampaign();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [token, setToken] = useState('USDC');
  const [expiry, setExpiry] = useState('');

  // Track loading state per campaign
  const [loadingCampaigns, setLoadingCampaigns] = useState<Record<string, string | null>>({});

  const activeCampaigns = useMemo(
    () =>
      campaigns.filter((campaign: Campaign) => {
        if (campaign.status === 'archived') return false;
        return true;
      }),
    [campaigns],
  );

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
    if (!name.trim() || !budget.trim()) {
      toast('Validation Error', 'Name and budget are required.', 'warning');
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
      toast('Campaign Created', 'Your campaign has been created successfully.', 'success');
    } catch (err) {
      toast('Creation Failed', (err as Error).message ?? 'Failed to create campaign.', 'error');
    }
  };

  const onPauseResume = async (id: string, currentStatus: CampaignStatus) => {
    const targetStatus = currentStatus === 'active' ? 'paused' : 'active';
    const action = targetStatus === 'paused' ? 'Pausing' : 'Resuming';
    
    setLoadingCampaigns(prev => ({ ...prev, [id]: action }));
    
    try {
      await updateCampaign.mutateAsync({ id, data: { status: targetStatus } });
      toast(
        `Campaign ${targetStatus === 'active' ? 'Resumed' : 'Paused'}`,
        `Campaign has been ${targetStatus === 'active' ? 'resumed' : 'paused'} successfully.`,
        'success'
      );
    } catch (err) {
      toast('Update Failed', (err as Error).message ?? 'Failed to update campaign.', 'error');
    } finally {
      setLoadingCampaigns(prev => ({ ...prev, [id]: null }));
    }
  };

  const onArchive = async (id: string) => {
    setLoadingCampaigns(prev => ({ ...prev, [id]: 'Archiving' }));
    
    try {
      await archiveCampaign.mutateAsync(id);
      toast('Campaign Archived', 'Campaign has been archived successfully.', 'success');
    } catch (err) {
      toast('Archive Failed', (err as Error).message ?? 'Failed to archive campaign.', 'error');
    } finally {
      setLoadingCampaigns(prev => ({ ...prev, [id]: null }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-gray-50 p-6 dark:to-gray-950">
      <main className="container mx-auto space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-4xl font-bold">NGO Campaigns</h1>
          <span className="text-sm text-gray-500">Role: {userRoleLabel}</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 text-xl font-semibold">Create New Campaign</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <label className="block">
                <span className="font-medium">Name</span>
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 25000"
                  required
                />
              </label>

              <label className="block">
                <span className="font-medium">Token</span>
                <input
                  value={token}
                  onChange={event => setToken(event.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. USDC"
                />
              </label>

              <label className="block">
                <span className="font-medium">Expiry date</span>
                <input
                  type="date"
                  value={expiry}
                  onChange={event => setExpiry(event.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <button
                type="submit"
                disabled={createCampaign.isPending}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createCampaign.isPending ? 'Creating...' : 'Create campaign'}
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
            {!isLoading && !isError && activeCampaigns.length === 0 && (
              <p className="text-gray-500">No campaigns match the current filter.</p>
            )}

            <div className="space-y-3">
              {activeCampaigns.map((campaign: Campaign) => (
                <div
                  key={campaign.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold">{campaign.name}</h3>
                      <p className="text-sm text-gray-500">
                        Budget:{' '}
                        {campaign.budget.toLocaleString('en-US', {
                          style: 'currency',
                          currency: 'USD',
                        })}
                      </p>
                      <p className="text-sm text-gray-500">
                        Token: {campaign.metadata?.token ?? 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500">
                        Expiry:{' '}
                        {campaign.metadata?.expiry
                          ? new Date(campaign.metadata.expiry as string).toLocaleDateString()
                          : 'N/A'}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${statusStyles[campaign.status as CampaignStatus]}`}
                    >
                      {campaign.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPauseResume(campaign.id, campaign.status as CampaignStatus)}
                      disabled={loadingCampaigns[campaign.id] !== null}
                      className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      {loadingCampaigns[campaign.id] || (campaign.status === 'active' ? 'Pause' : 'Resume')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onArchive(campaign.id)}
                      disabled={loadingCampaigns[campaign.id] !== null || campaign.status === 'archived'}
                      className="rounded-md border border-red-400 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
                    >
                      {loadingCampaigns[campaign.id] === 'Archiving' ? 'Archiving...' : 'Archive'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
