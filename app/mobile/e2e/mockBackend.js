/**
 * Deterministic backend stand-in for the end-to-end harness (issue #932).
 *
 * The E2E flows exercise real network behaviour — queue while offline,
 * flush on reconnect — so they need a backend that answers the handful of
 * endpoints those flows touch with stable data, without standing up the
 * NestJS service, Postgres and the on-chain adapter in CI.
 *
 * This is deliberately a thin local stand-in, not a reimplementation of
 * the API: it implements exactly the paths the mobile clients call during
 * the core field flows (aid details, evidence upload sessions, claim
 * verify/submit) and nothing else. Contract-level correctness of those
 * responses is covered by the backend's own OpenAPI tests; this server
 * exists so the *client* can be driven end to end.
 *
 * `startMockBackend()` is only used by `e2e/run-e2e.js`; `createRequestHandler`
 * and `createStore` are exported pure-ish pieces so they can be tested
 * without a device.
 */

'use strict';

const http = require('node:http');

/** Minimal in-memory state for upload sessions created during a run. */
function createStore() {
  return {
    uploadSessions: new Map(),
    evidenceUploads: 0,
    claimVerifications: 0,
    claimSubmissions: 0,
  };
}

const nowIso = () => new Date().toISOString();

/** The aid package every E2E flow scans / opens (see testMode.ts). */
const E2E_AID_ID = 'E2E-AID-1';

function aidDetails(aidId) {
  return {
    id: aidId,
    title: 'E2E Emergency Food Supply',
    description: 'Deterministic aid package served by the E2E mock backend.',
    recipient: {
      name: 'E2E Recipient',
      id: 'REC-E2E-1',
      wallet: 'GAKD...Q9X2',
    },
    tokenType: 'USDC',
    amount: '150',
    expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'verified',
    claimId: `claim-${aidId}`,
    createdAt: nowIso(),
    verifiedAt: nowIso(),
    approvalTransactionHash: 'f'.repeat(64),
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Builds the Node request listener. Exported so tests can invoke it via a
 * real ephemeral server without the CLI.
 *
 * @param {ReturnType<typeof createStore>} [store]
 */
function createRequestHandler(store = createStore()) {
  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // Health probe (used by diagnostics / Health Screen).
    if (method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'e2e-mock-backend',
        version: '1.0.0',
        environment: 'e2e',
        timestamp: nowIso(),
        mocked: true,
      });
    }

    // Aid list + details.
    if (method === 'GET' && pathname === '/aid') {
      return sendJson(res, 200, [
        {
          id: E2E_AID_ID,
          title: 'E2E Emergency Food Supply',
          description: 'Deterministic aid package served by the E2E mock backend.',
          status: 'active',
          location: 'E2E Zone 1',
          createdAt: nowIso(),
        },
      ]);
    }

    const aidMatch = /^\/aid\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && aidMatch) {
      return sendJson(res, 200, aidDetails(decodeURIComponent(aidMatch[1])));
    }

    // Evidence upload sessions (mirrors syncQueue.runAction's calls).
    if (method === 'POST' && pathname === '/evidence/upload-sessions') {
      let raw = '';
      req.on('data', chunk => {
        raw += chunk;
      });
      req.on('end', () => {
        let totalSize = 0;
        let chunkSize = 512 * 1024;
        let fileName = 'evidence.jpg';
        try {
          const parsed = JSON.parse(raw || '{}');
          totalSize = Number(parsed.totalSize) || 0;
          chunkSize = Number(parsed.chunkSize) || chunkSize;
          fileName = parsed.fileName || fileName;
        } catch {
          // Malformed body: fall through with defaults.
        }
        const totalChunks = totalSize > 0 ? Math.max(1, Math.ceil(totalSize / chunkSize)) : 1;
        const id = `session-${store.uploadSessions.size + 1}`;
        store.uploadSessions.set(id, { id, fileName, totalChunks, receivedChunks: [] });
        sendJson(res, 201, { id, totalChunks, chunkSize });
      });
      return undefined;
    }

    const statusMatch = /^\/evidence\/upload-sessions\/([^/]+)\/status$/.exec(pathname);
    if (method === 'GET' && statusMatch) {
      const session = store.uploadSessions.get(decodeURIComponent(statusMatch[1]));
      if (!session) return sendJson(res, 404, { message: 'session not found' });
      return sendJson(res, 200, {
        receivedChunks: session.receivedChunks,
        totalChunks: session.totalChunks,
      });
    }

    const chunkMatch = /^\/evidence\/upload-sessions\/([^/]+)\/chunks$/.exec(pathname);
    if (method === 'POST' && chunkMatch) {
      const session = store.uploadSessions.get(decodeURIComponent(chunkMatch[1]));
      req.resume();
      if (!session) return sendJson(res, 404, { message: 'session not found' });
      store.evidenceUploads += 1;
      return sendJson(res, 200, { ok: true });
    }

    const finalizeMatch = /^\/evidence\/upload-sessions\/([^/]+)\/finalize$/.exec(pathname);
    if (method === 'POST' && finalizeMatch) {
      const id = decodeURIComponent(finalizeMatch[1]);
      const session = store.uploadSessions.get(id);
      req.resume();
      if (!session) return sendJson(res, 404, { message: 'session not found' });
      session.receivedChunks = Array.from(
        { length: session.totalChunks },
        (_, index) => index,
      );
      return sendJson(res, 200, {
        ok: true,
        id,
        url: `/evidence/${id}`,
      });
    }

    // Claim verify + submit (used by the offline queue's claim paths).
    const verifyMatch = /^\/claims\/([^/]+)\/verify$/.exec(pathname);
    if (method === 'POST' && verifyMatch) {
      req.resume();
      store.claimVerifications += 1;
      return sendJson(res, 200, { verified: true, claimId: decodeURIComponent(verifyMatch[1]) });
    }

    const submitMatch = /^\/claims\/([^/]+)\/submit$/.exec(pathname);
    if (method === 'POST' && submitMatch) {
      req.resume();
      store.claimSubmissions += 1;
      return sendJson(res, 201, { ok: true, claimId: decodeURIComponent(submitMatch[1]) });
    }

    return sendJson(res, 404, { message: `No E2E mock route for ${method} ${pathname}` });
  };
}

/**
 * Starts the mock backend on `port` (0 = ephemeral). Resolves once it is
 * listening so the orchestrator can point the app at a real URL.
 *
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ url: string, port: number, store: ReturnType<typeof createStore>, close: () => Promise<void> }>}
 */
function startMockBackend(options = {}) {
  const host = options.host || '0.0.0.0';
  const store = createStore();
  const server = http.createServer(createRequestHandler(store));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({
        url: `http://${host}:${port}`,
        port,
        store,
        close: () =>
          new Promise(resolveClose => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

module.exports = {
  E2E_AID_ID,
  aidDetails,
  createStore,
  createRequestHandler,
  startMockBackend,
};
