import { fetchClient } from '@/lib/mock-api/client';
import type {
  VerificationInboxResponse,
  VerificationInboxItem,
  VerificationStats,
  InternalNote,
  ReviewFilters,
} from '@/types/verification-review';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = `${API_URL}/v1/verification-inbox`;

function buildParams(filters: Partial<ReviewFilters>): string {
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.page && filters.page > 1) p.set('page', String(filters.page));
  if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) p.set('dateTo', filters.dateTo);
  const q = p.toString();
  return q ? `?${q}` : '';
}

export async function fetchInbox(
  filters: Partial<ReviewFilters>,
): Promise<VerificationInboxResponse> {
  const res = await fetchClient(`${BASE}${buildParams(filters)}`);
  if (!res.ok) throw new Error(`Failed to fetch inbox: ${res.status}`);
  return res.json() as Promise<VerificationInboxResponse>;
}

export async function fetchStats(): Promise<VerificationStats> {
  const res = await fetchClient(`${BASE}/stats`);
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json() as Promise<VerificationStats>;
}

export async function fetchDetails(id: string): Promise<VerificationInboxItem> {
  const res = await fetchClient(`${BASE}/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch verification: ${res.status}`);
  return res.json() as Promise<VerificationInboxItem>;
}

export async function approveVerification(
  id: string,
  payload: { nextStepMessage?: string; internalNote?: string },
): Promise<VerificationInboxItem> {
  const res = await fetchClient(`${BASE}/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ?? `Approve failed: ${res.status}`,
    );
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
  const res = await fetchClient(`${BASE}/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ?? `Reject failed: ${res.status}`,
    );
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
  const res = await fetchClient(`${BASE}/${id}/request-resubmission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ??
        `Resubmission request failed: ${res.status}`,
    );
  }
  return res.json() as Promise<VerificationInboxItem>;
}

export async function fetchNotes(id: string): Promise<InternalNote[]> {
  const res = await fetchClient(`${BASE}/${id}/notes`);
  if (!res.ok) throw new Error(`Failed to fetch notes: ${res.status}`);
  return res.json() as Promise<InternalNote[]>;
}

export async function addNote(
  id: string,
  payload: { content: string; category?: string },
): Promise<InternalNote> {
  const res = await fetchClient(`${BASE}/${id}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ??
        `Add note failed: ${res.status}`,
    );
  }
  return res.json() as Promise<InternalNote>;
}
