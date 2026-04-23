'use client';

import { useMemo, useState } from 'react';
import { useCampaigns, useCreateCampaign, useUpdateCampaign } from '@/hooks/useCampaigns';
import type { CampaignStatus } from '@/types/campaign';
import { ExportControls } from '@/components/dashboard/ExportControls';

const ALLOWED_ROLES = ['ngo', 'admin'];
const userRole = process.env.NEXT_PUBLIC_USER_ROLE ?? 'guest';

const statusStyles: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
  archived: 'bg-red-100 text-red-800',
};

export default function CampaignsPage() {
  const { data: campaigns = [], isLoading, isError, error } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();

  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [token, setToken] = useState('USDC');
  const [expiry, setExpiry] = useState('');
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const activeCampaigns = useMemo(
    () => campaigns.filter(campaign => campaign.status !== 'archived'),
    [campaigns]
  );

  if (!ALLOWED_ROLES.includes(userRole)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-lg mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800">
          <h1 className="text-2xl font-semibold text-red-600">Access Denied</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
            This page is for NGO or Admin roles only. Your role is <strong>{userRole}</strong>.
          </p>
        </div>
      </div>
    );
  }

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  const onPauseResume = async (id: string, currentStatus: CampaignStatus) => {
    const targetStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      await updateCampaign.mutateAsync({ id, data: { status: targetStatus } });
      setFormMessage(`Campaign ${targetStatus === 'active' ? 'resumed' : 'paused'} successfully.`);
    } catch (err) {
      setFormMessage((err as Error).message ?? 'Failed to update campaign.');
    }
  };

  const onArchive = async (id: string) => {
    try {
      await updateCampaign.mutateAsync({ id, data: { status: 'archived' } });
      setFormMessage('Campaign archived successfully.');
    } catch (err) {
      setFormMessage((err as Error).message ?? 'Failed to archive campaign.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-gray-50 dark:to-gray-950 p-6">
      <main className="container mx-auto space-y-8">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <h1 className="text-4xl font-bold">NGO Campaigns</h1>
          <span className="text-sm text-gray-500">Role: {userRole}</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">Create New Campaign</h2>
            {formMessage && (
              <div className="mb-4 rounded-md border p-3 text-sm text-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-200">
                {formMessage}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-3">
              <label className="block">
                <span className="font-medium">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  onChange={(e) => setBudget(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 25000"
                  required
                />
              </label>

              <label className="block">
                <span className="font-medium">Token</span>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. USDC"
                />
              </label>

              <label className="block">
                <span className="font-medium">Expiry date</span>
                <input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <button
                type="submit"
                disabled={createCampaign.isPending}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createCampaign.isPending ? 'Creating…' : 'Create campaign'}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h2 className="text-xl font-semibold">Active Campaigns</h2>
              <ExportControls context="Campaigns" filters={{ activeOnly: true }} />
            </div>

            {isLoading && <p>Loading campaigns…</p>}
            {isError && <p className="text-red-500">Error fetching campaigns: {(error as Error)?.message}</p>}
            {!isLoading && !isError && activeCampaigns.length === 0 && (
              <p className="text-gray-500">No active campaigns available.</p>
            )}

            <div className="space-y-3">
              {activeCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-950"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h3 className="text-lg font-semibold">{campaign.name}</h3>
                      <p className="text-sm text-gray-500">Budget: {campaign.budget.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                      <p className="text-sm text-gray-500">Token: {campaign.metadata?.token ?? 'N/A'}</p>
                      <p className="text-sm text-gray-500">Expiry: {campaign.metadata?.expiry ? new Date(campaign.metadata.expiry as string).toLocaleDateString() : 'N/A'}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusStyles[campaign.status]}`}>
                      {campaign.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onPauseResume(campaign.id, campaign.status)}
                      disabled={updateCampaign.isPending}
                      className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      {campaign.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => onArchive(campaign.id)}
                      disabled={updateCampaign.isPending || campaign.status === 'archived'}
                      className="rounded-md border border-red-400 text-red-700 px-3 py-1 text-sm hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      Archive
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
