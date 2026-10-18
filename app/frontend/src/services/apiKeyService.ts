export interface ApiKey {
  id: string;
  name: string;
  key: string;
  /** Short, non-sensitive hint for the key (e.g. last characters). */
  keyHint?: string;
  createdAt: string;
  lastUsedAt?: string;
  isActive: boolean;
  /** Lifecycle state, including transient `grace_period` during rotation. */
  status?: string;
  /** Remaining overlap window while a rotated key is still accepted. */
  graceWindowRemaining?: string;
}

export async function getKeys(): Promise<ApiKey[]> {
  const res = await fetch('/api/admin/keys');
  if (!res.ok) throw new Error('Failed to fetch API keys');
  return res.json();
}

export async function rotateKey(id: string): Promise<{ newSecret?: string }> {
  const res = await fetch(`/api/admin/keys/${id}/rotate`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to rotate API key');

  // The rotate endpoint may return the successor secret as JSON, or an empty
  // body (204 / no content). Only surface the secret when one is present.
  if (res.status === 204) return {};
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return {};
  try {
    return (await res.json()) as { newSecret?: string };
  } catch {
    return {};
  }
}

export async function revokeKey(id: string): Promise<void> {
  const res = await fetch(`/api/admin/keys/${id}/revoke`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to revoke API key');
}

export async function createKey(): Promise<ApiKey> {
  const res = await fetch('/api/admin/keys', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to create API key');
  return res.json();
}