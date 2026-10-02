import { fetchClient, resolveApiUrl } from '@/lib/api-client';
import { extractApiError } from '@/lib/error-utils';
import type {
  VerificationInboxResponse,
  VerificationInboxItem,
  VerificationStats,
  InternalNote,
  ReviewFilters,
} from '@/types/verification-review';

function baseUrl(): string {
  return `${resolveApiUrl()}/v1/verification-inbox`;
}

function buildParams(filters: Partial<ReviewFilters>): string {
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.riskLevel) p.set('riskLevel', filters.riskLevel);
  if (filters.campaignId) p.set('campaignId', filters.campaignId);
  if (filters.page && filters.page > 1) p.set('page', String(filters.page));
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) p.set('dateTo', filters.dateTo);
  const q = p.toString();
  return q ? `?${q}` : '';
}

export async function fetchInbox(
  filters: Partial<ReviewFilters>,
): Promise<VerificationInboxResponse> {
  const res = await fetchClient(`${baseUrl()}${buildParams(filters)}`);
  if (!res.ok) throw await extractApiError(res);
  return res.json() as Promise<VerificationInboxResponse>;
}

export async function fetchStats(): Promise<VerificationStats> {
  const res = await fetchClient(`${baseUrl()}/stats`);
  if (!res.ok) throw await extractApiError(res);
  return res.json() as Promise<VerificationStats>;
}

export async function fetchDetails(id: string): Promise<VerificationInboxItem> {
  const res = await fetchClient(`${baseUrl()}/${id}`);
  if (!res.ok) throw await extractApiError(res);
  return res.json() as Promise<VerificationInboxItem>;
}

export async function approveVerification(
  id: string,
  payload: { nextStepMessage?: string; internalNote?: string },
): Promise<VerificationInboxItem> {
  const res = await fetchClient(`${baseUrl()}/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await extractApiError(res);
  }
  return res.json() as Promise<VerificationInboxItem>;
}

export async function rejectVerification(
  id: string,
  payload: {
    rejectionReason: string;
    nextStepMessage?: string;
    internalNote?: string;
  },
): Promise<VerificationInboxItem> {
  const res = await fetchClient(`${baseUrl()}/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await extractApiError(res);
  }
  return res.json() as Promise<VerificationInboxItem>;
}

export async function requestResubmission(
  id: string,
  payload: {
    rejectionReason: string;
    nextStepMessage: string;
    internalNote?: string;
  },
): Promise<VerificationInboxItem> {
  const res = await fetchClient(`${baseUrl()}/${id}/request-resubmission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await extractApiError(res);
  }
  return res.json() as Promise<VerificationInboxItem>;
}

export async function fetchNotes(id: string): Promise<InternalNote[]> {
  const res = await fetchClient(`${baseUrl()}/${id}/notes`);
  if (!res.ok) throw await extractApiError(res);
  return res.json() as Promise<InternalNote[]>;
}

export async function addNote(
  id: string,
  payload: { content: string; category?: string },
): Promise<InternalNote> {
  const res = await fetchClient(`${baseUrl()}/${id}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await extractApiError(res);
  }
  return res.json() as Promise<InternalNote>;
}
