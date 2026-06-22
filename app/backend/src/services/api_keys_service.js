// app/backend/src/services/api_keys_service.js
const db = require('../db');
const crypto = require('crypto');

function maskKey(key) {
  return key.slice(0, 6) + '****' + key.slice(-4);
}

async function listKeys() {
  const res = await db.query('SELECT * FROM api_keys');
  return res.rows.map(k => ({
    id: k.id,
    masked: maskKey(k.key),
    creator: k.creator,
    createdAt: k.created_at,
    lastUsed: k.last_used,
  }));
}

async function createKey(creatorId) {
  const rawKey = crypto.randomBytes(32).toString('hex');
  await db.query(
    'INSERT INTO api_keys (id, key, creator, created_at) VALUES (gen_random_uuid(), $1, $2, NOW())',
    [rawKey, creatorId]
  );
  return { masked: maskKey(rawKey) };
}

async function rotateKey(id) {
  const newKey = crypto.randomBytes(32).toString('hex');
  await db.query('UPDATE api_keys SET key=$1, created_at=NOW() WHERE id=$2', [newKey, id]);
}

async function revokeKey(id) {
  await db.query('DELETE FROM api_keys WHERE id=$1', [id]);
}

module.exports = { listKeys, createKey, rotateKey, revokeKey };
