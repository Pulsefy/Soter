import axios from 'axios';

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt?: string;
  isActive: boolean;
}

export async function getKeys(): Promise<ApiKey[]> {
  const res = await axios.get('/api/admin/keys');
  return res.data;
}

export async function rotateKey(id: string): Promise<void> {
  await axios.post(`/api/admin/keys/${id}/rotate`);
}

export async function revokeKey(id: string): Promise<void> {
  await axios.post(`/api/admin/keys/${id}/revoke`);
}

export async function createKey(): Promise<ApiKey> {
  const res = await axios.post('/api/admin/keys');
  return res.data;
}