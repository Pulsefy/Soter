// app/backend/tests/api_keys_tests.js
const service = require('../src/services/api_keys_service');

describe('API Key Service', () => {
  it('creates a new key', async () => {
    const key = await service.createKey('admin1');
    expect(key.masked).toMatch(/^\w{6}\*{4}\w{4}$/);
  });

  it('rotates a key', async () => {
    const keys = await service.listKeys();
    await service.rotateKey(keys[0].id);
    const updated = await service.listKeys();
    expect(updated[0].createdAt).not.toBe(keys[0].createdAt);
  });

  it('revokes a key', async () => {
    const keys = await service.listKeys();
    await service.revokeKey(keys[0].id);
    const updated = await service.listKeys();
    expect(updated.find(k => k.id === keys[0].id)).toBeUndefined();
  });
});
