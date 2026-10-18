'use strict';

const { E2E_AID_ID, startMockBackend } = require('../mockBackend');

describe('e2e mock backend', () => {
  let server;

  beforeAll(async () => {
    server = await startMockBackend({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await server.close();
  });

  it('serves aid details for the package the flows scan', async () => {
    const response = await fetch(`${server.url}/aid/${E2E_AID_ID}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(E2E_AID_ID);
    expect(body.claimId).toBe(`claim-${E2E_AID_ID}`);
    expect(body.status).toBe('verified');
  });

  it('serves the health probe', async () => {
    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('ok');
  });

  it('runs a full evidence upload session: create, status, chunk, finalize', async () => {
    const create = await fetch(`${server.url}/evidence/upload-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'evidence.jpg',
        mimeType: 'image/jpeg',
        totalSize: 1024,
        chunkSize: 512,
      }),
    });
    expect(create.status).toBe(201);
    const session = await create.json();
    expect(session.totalChunks).toBe(2);

    const status = await fetch(
      `${server.url}/evidence/upload-sessions/${session.id}/status`,
    );
    expect((await status.json()).receivedChunks).toEqual([]);

    const chunk = await fetch(
      `${server.url}/evidence/upload-sessions/${session.id}/chunks`,
      { method: 'POST', body: 'chunk-bytes' },
    );
    expect(chunk.status).toBe(200);

    const finalize = await fetch(
      `${server.url}/evidence/upload-sessions/${session.id}/finalize`,
      { method: 'POST' },
    );
    expect(finalize.status).toBe(200);
    expect((await finalize.json()).ok).toBe(true);
    expect(server.store.evidenceUploads).toBeGreaterThanOrEqual(1);
  });

  it('accepts claim verify and submit', async () => {
    const verify = await fetch(`${server.url}/claims/claim-1/verify`, {
      method: 'POST',
    });
    expect(verify.status).toBe(200);
    expect((await verify.json()).verified).toBe(true);

    const submit = await fetch(`${server.url}/claims/claim-1/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(submit.status).toBe(201);
    expect(server.store.claimSubmissions).toBe(1);
  });

  it('404s unknown routes', async () => {
    const response = await fetch(`${server.url}/not-a-route`);
    expect(response.status).toBe(404);
  });
});
