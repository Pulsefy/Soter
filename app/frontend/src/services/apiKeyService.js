// app/frontend/src/services/apiKeyService.js
import axios from 'axios';

export async function getKeys() {
  const res = await axios.get('/api/admin/keys');
  return res.data;
}

export async function rotateKey(id) {
  await axios.post(`/api/admin/keys/${id}/rotate`);
}

export async function revokeKey(id) {
  await axios.post(`/api/admin/keys/${id}/revoke`);
}

export async function createKey() {
  const res = await axios.post('/api/admin/keys');
  return res.data;
}
