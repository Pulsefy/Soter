export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt?: string;
  isActive: boolean;
}

export async function getKeys(): Promise<ApiKey[]> {
  const res = await fetch('/api/admin/keys');
  if (!res.ok) throw new Error('Failed to fetch API keys');
  return res.json();
}

export async function rotateKey(id: string): Promise<void> {
  const res = await fetch(`/api/admin/keys/${id}/rotate`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to rotate API key');
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