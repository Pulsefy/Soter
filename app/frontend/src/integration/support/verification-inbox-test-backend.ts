/**
 * In-process test backend for the verification-review route smoke test.
 *
 * The reviewer route is the frontend's busiest consumer of the backend's
 * verification-inbox API, so the smoke test drives it against a real HTTP
 * server instead of a mocked `fetchClient`. That keeps the parts most likely to
 * drift under test: URL construction, status handling, JSON parsing and the
 * invalidate-and-refetch cycle the review mutations rely on.
 *
 * Routes mirror `VerificationInboxController`
 * (app/backend/src/verification/verification-inbox.controller.ts) and
 * `VerificationInboxService` (…/verification-inbox.service.ts):
 *
 *   GET  /v1/verification-inbox             list + status/page/limit filtering
 *   GET  /v1/verification-inbox/stats       counts per status
 *   GET  /v1/verification-inbox/:id         detail
 *   GET  /v1/verification-inbox/:id/notes   internal notes
 *   POST /v1/verification-inbox/:id/notes   add internal note
 *   POST /v1/verification-inbox/:id/approve approve  → { …item, lockReleased: true }
 *   POST /v1/verification-inbox/:id/reject  reject   → { …item, lockReleased: true }
 *
 * `GET /v1/campaigns` is served too: the filters bar loads campaigns through
 * `api-client.ts`, which addresses `${API_URL}/api/v1/…`, and a 404 there would
 * otherwise fail an unrelated query during every run.
 *
 * Two deliberate deviations from the real controller, both documented so the
 * gap is visible rather than silently papered over:
 *
 *  1. No review-lock gate. The real `approve`/`reject` handlers first call
 *     `ReviewLockService.verifyLockOwnership`, while the frontend never
 *     acquires a lock. That wiring gap belongs to the claims/verification
 *     backend work; the smoke test exercises the review actions themselves.
 *  2. Both the `/v1/…` and the global-prefix `/api/v1/…` spellings are
 *     accepted, because the frontend is currently split between them.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  InternalNote,
  VerificationInboxItem,
  VerificationInboxResponse,
  VerificationStats,
  VerificationStatus,
} from '@/types/verification-review';

/** Route prefix used by the frontend (`lib/verification-inbox-api.ts`). */
const INBOX_PREFIX = '/v1/verification-inbox';

/** Reviewer id recorded on reviewed items. */
const REVIEWER_ID = 'reviewer-smoke';

/** Fixtures are fixed so every assertion in the smoke test is stable. */
const SEED_ITEMS: VerificationInboxItem[] = [
  {
    id: 'clv-approve-001',
    status: 'pending_review',
    createdAt: '2026-02-03T11:40:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: 'Review the uploaded national ID',
    deepLink: '/verification/clv-approve-001',
    aiScore: 0.21,
    riskLevel: 'high',
    documentType: 'national_id',
  },
  {
    id: 'clv-reject-002',
    status: 'pending_review',
    createdAt: '2026-02-02T09:15:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    nextStepMessage: 'Review the uploaded utility bill',
    deepLink: '/verification/clv-reject-002',
    aiScore: 0.48,
    riskLevel: 'medium',
    documentType: 'utility_bill',
  },
  {
    id: 'clv-resubmit-003',
    status: 'needs_resubmission',
    createdAt: '2026-01-28T08:05:00.000Z',
    reviewedAt: '2026-01-29T10:00:00.000Z',
    reviewedBy: REVIEWER_ID,
    rejectionReason: 'Document expired',
    nextStepMessage: 'Please resubmit a current document',
    deepLink: '/verification/clv-resubmit-003',
    aiScore: 0.77,
    riskLevel: 'low',
    documentType: 'residence_permit',
  },
];

/** One request as the test backend saw it. */
export interface RecordedRequest {
  method: string;
  /** Path with the global prefix already stripped, e.g. `/v1/verification-inbox/clv-approve-001/approve`. */
  path: string;
  query: Record<string, string>;
  body: unknown;
  /** Status the request was answered with. */
  status: number;
}

export interface VerificationInboxTestBackend {
  /** Base URL to hand to the app, e.g. `http://127.0.0.1:53124`. */
  readonly url: string;
  /** Every request received since the last `reset()`, in arrival order. */
  readonly requests: RecordedRequest[];
  /** Current state of an item, or `undefined` when the id is unknown. */
  item(id: string): VerificationInboxItem | undefined;
  /** Current counts per status. */
  stats(): VerificationStats;
  /** Restores the seed fixtures and clears the recorded requests. */
  reset(): void;
  /** Stops the server and releases the port. */
  close(): Promise<void>;
}

/** Deep clone so callers can never mutate the backend's state by reference. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Mirrors `AllExceptionsFilter`'s error body (…/common/filters/http-exception.filter.ts). */
function sendError(
  res: ServerResponse,
  status: number,
  errorCode: string,
  message: string,
  path: string,
): void {
  sendJson(res, status, {
    code: status,
    errorCode,
    message,
    timestamp: '2026-02-04T00:00:00.000Z',
    path,
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function countStats(items: VerificationInboxItem[]): VerificationStats {
  const stats: VerificationStats = {
    pending_review: 0,
    approved: 0,
    rejected: 0,
    needs_resubmission: 0,
    total: 0,
  };
  for (const item of items) {
    stats[item.status] += 1;
    stats.total += 1;
  }
  return stats;
}

/**
 * Mirrors `VerificationInboxService.getInbox`: status filter, `skip`/`take`
 * pagination, newest first, plus the `lock: null` field the real service adds.
 */
function listInbox(
  items: VerificationInboxItem[],
  query: Record<string, string>,
): VerificationInboxResponse {
  const page = Number(query.page ?? 1) || 1;
  const limit = Number(query.limit ?? 20) || 20;
  const status = query.status as VerificationStatus | undefined;

  const matching = items
    .filter(item => !status || item.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    items: clone(matching.slice((page - 1) * limit, page * limit)).map(item => ({
      ...item,
      lock: null,
    })),
    total: matching.length,
    page,
    limit,
    totalPages: Math.ceil(matching.length / limit),
  };
}

/** Body accepted by the approve endpoint. */
interface ReviewPayload {
  nextStepMessage?: string;
  rejectionReason?: string;
  internalNote?: string;
}

/**
 * Mirrors `VerificationInboxService.updateStatus`: unknown id → 404, an
 * already-decided request → 400, otherwise the review fields are written and
 * the internal note (when present) is appended.
 */
function applyReview(
  items: VerificationInboxItem[],
  notes: InternalNote[],
  id: string,
  status: VerificationStatus,
  payload: ReviewPayload,
): { status: number; body: unknown } {
  const item = items.find(candidate => candidate.id === id);
  if (!item) {
    return {
      status: 404,
      body: { code: 404, errorCode: 'NOT_FOUND', message: 'Verification request not found' },
    };
  }
  if (item.status === 'approved' || item.status === 'rejected') {
    return {
      status: 400,
      body: { code: 400, errorCode: 'BAD_REQUEST', message: 'Verification already processed' },
    };
  }

  item.status = status;
  item.reviewedAt = '2026-02-04T12:00:00.000Z';
  item.reviewedBy = REVIEWER_ID;
  if (payload.nextStepMessage) item.nextStepMessage = payload.nextStepMessage;
  if (payload.rejectionReason) item.rejectionReason = payload.rejectionReason;

  if (payload.internalNote) {
    notes.push({
      id: `note-${notes.length + 1}`,
      entityType: 'verification',
      entityId: id,
      content: payload.internalNote,
      authorId: REVIEWER_ID,
      category: `review_${status}`,
      createdAt: item.reviewedAt,
      updatedAt: item.reviewedAt,
    });
  }

  return { status: 200, body: { ...clone(item), lock: null, lockReleased: true } };
}

/**
 * Starts the test backend on an ephemeral loopback port.
 *
 * Use an ephemeral port (rather than a fixed one) so parallel runs and local
 * dev servers cannot collide.
 */
export async function startVerificationInboxTestBackend(): Promise<VerificationInboxTestBackend> {
  let items: VerificationInboxItem[] = clone(SEED_ITEMS);
  let notes: InternalNote[] = [];
  const requests: RecordedRequest[] = [];

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // The real backend serves under `app.setGlobalPrefix('api')`; the frontend
    // is currently inconsistent about including it, so accept both spellings.
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    const query = Object.fromEntries(url.searchParams.entries());

    const record: RecordedRequest = { method, path, query, body: null, status: 0 };
    requests.push(record);

    // Every reply goes through these so the request log records the status the
    // route actually received; tests use that to catch unrouted calls.
    const reply = (status: number, payload: unknown): void => {
      record.status = status;
      sendJson(res, status, payload);
    };
    const refuse = (status: number, errorCode: string, message: string): void => {
      record.status = status;
      sendError(res, status, errorCode, message, path);
    };

    let body: unknown = {};
    try {
      body = method === 'GET' ? {} : await readJsonBody(req);
      record.body = body;
    } catch {
      refuse(400, 'BAD_REQUEST', 'Request body is not valid JSON');
      return;
    }

    if (path === '/v1/campaigns' && method === 'GET') {
      // `useCampaigns` expects the `ApiResponseDto.ok` envelope.
      reply(200, { success: true, data: [] });
      return;
    }

    if (!path.startsWith(INBOX_PREFIX)) {
      refuse(404, 'NOT_FOUND', `No route for ${method} ${path}`);
      return;
    }

    const segments = path.slice(INBOX_PREFIX.length).split('/').filter(Boolean);

    if (segments.length === 0) {
      if (method !== 'GET') {
        refuse(405, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed`);
        return;
      }
      reply(200, listInbox(items, query));
      return;
    }

    const [id, action] = segments;

    if (segments.length === 1 && id === 'stats' && method === 'GET') {
      reply(200, countStats(items));
      return;
    }

    const item = items.find(candidate => candidate.id === id);

    if (segments.length === 2 && action === 'notes' && method === 'GET') {
      reply(200, clone(notes.filter(note => note.entityId === id)));
      return;
    }

    if (segments.length === 2 && action === 'notes' && method === 'POST') {
      if (!item) {
        refuse(404, 'NOT_FOUND', 'Verification request not found');
        return;
      }
      const payload = (body ?? {}) as { content?: string; category?: string };
      const note: InternalNote = {
        id: `note-${notes.length + 1}`,
        entityType: 'verification',
        entityId: id,
        content: payload.content ?? '',
        authorId: REVIEWER_ID,
        category: payload.category ?? null,
        createdAt: '2026-02-04T12:00:00.000Z',
        updatedAt: '2026-02-04T12:00:00.000Z',
      };
      notes.push(note);
      reply(201, clone(note));
      return;
    }

    if (segments.length === 2 && (action === 'approve' || action === 'reject') && method === 'POST') {
      const payload = (body ?? {}) as ReviewPayload;
      if (action === 'reject' && !payload.rejectionReason) {
        refuse(400, 'BAD_REQUEST', 'rejectionReason is required');
        return;
      }
      const result = applyReview(
        items,
        notes,
        id,
        action === 'approve' ? 'approved' : 'rejected',
        payload,
      );
      reply(result.status, result.body);
      return;
    }

    if (segments.length === 1 && method === 'GET') {
      if (!item) {
        refuse(404, 'NOT_FOUND', 'Verification request not found');
        return;
      }
      reply(200, { ...clone(item), lock: null });
      return;
    }

    refuse(404, 'NOT_FOUND', `No route for ${method} ${path}`);
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res).catch(() => {
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Unhandled test backend error', req.url ?? '/');
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    item(id) {
      const found = items.find(candidate => candidate.id === id);
      return found ? clone(found) : undefined;
    },
    stats() {
      return countStats(items);
    },
    reset() {
      items = clone(SEED_ITEMS);
      notes = [];
      requests.length = 0;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    },
  };
}
