/**
 * SSE endpoint integration tests for the Verification Inbox (issue #707).
 *
 * Strategy:
 *  - These are in-process integration tests: we boot the full NestJS app
 *    (minus network I/O heavy external services that are mocked), connect
 *    directly to the VerificationInboxSseService, and trigger mutations via
 *    the HTTP API.  This lets us assert on the SSE message shape without
 *    needing a real HTTP streaming client.
 *
 *  - All SSE assertions are done by subscribing to the service's Observable
 *    directly — this avoids the complexities of long-lived HTTP streaming in
 *    Jest while still exercising the full service + controller pipeline.
 *
 *  - A separate section tests that the HTTP SSE endpoint returns the correct
 *    response headers and 200 status (auth + header contract).
 */

import {
  INestApplication,
  ValidationPipe,
  VersioningType,
  MessageEvent,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { VerificationInboxSseService } from '../src/verification/verification-inbox-sse.service';
import { App } from 'supertest/types';

const API_KEY = 'sse-inbox-e2e-test-key';

/**
 * Wait for the next event on the SSE service stream, optionally scoped to a
 * specific verificationId.  Resolves with the MessageEvent or rejects after
 * the given timeout (default 5 s).
 */
function nextEvent(
  sseService: VerificationInboxSseService,
  verificationId?: string,
  timeoutMs = 5000,
): Promise<MessageEvent> {
  return new Promise<MessageEvent>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for SSE event')),
      timeoutMs,
    );

    const sub = sseService.getStream(verificationId).subscribe({
      next: (msg) => {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(msg);
      },
      error: (err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      },
    });
  });
}

/**
 * Wait for the next HTTP response on a supertest request that opens an
 * SSE connection.  Aborts the request once the response headers arrive.
 */
function awaitSseResponse(
  req: request.Test,
): Promise<request.Response> {
  return new Promise<request.Response>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('SSE response did not arrive')),
      5000,
    );

    req
      .buffer(false)
      .parse((_res, _cb) => {
        // Intentionally left empty — we only want the headers.
      });

    req.on('response', (res: request.Response) => {
      clearTimeout(timer);
      req.abort();
      resolve(res);
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // ECONNRESET is expected when req.abort() is called.
      if (err.code === 'ECONNRESET') {
        // Already resolved — nothing to do.
      } else {
        reject(err);
      }
    });
  });
}

describe('Verification Inbox SSE (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sseService: VerificationInboxSseService;
  let moduleRef: TestingModule;

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────

  const auth = (req: request.Test) => req.set('x-api-key', API_KEY);

  async function seedVerification() {
    return prisma.verificationRequest.create({
      data: { status: 'pending_review' },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Bootstrap
  // ────────────────────────────────────────────────────────────

  beforeAll(async () => {
    process.env.API_KEY = API_KEY;

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
    sseService = app.get(VerificationInboxSseService);
  });

  beforeEach(async () => {
    await prisma.internalNote.deleteMany();
    await prisma.verificationRequest.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // HTTP endpoint — auth & header contract
  // ────────────────────────────────────────────────────────────

  describe('GET /api/v1/verification-inbox/events — auth & headers', () => {
    it('returns 401 when no API key is provided', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/verification-inbox/events')
        .expect(401);
    });

    it('opens the SSE stream with a valid API key (200, text/event-stream)', async () => {
      const res = await awaitSseResponse(
        request(app.getHttpServer())
          .get('/api/v1/verification-inbox/events')
          .set('x-api-key', API_KEY),
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      expect(res.headers['cache-control']).toMatch(/no-cache/);
    });

    it('scoped endpoint returns 200 for an existing verification id', async () => {
      const verification = await seedVerification();

      const res = await awaitSseResponse(
        request(app.getHttpServer())
          .get(`/api/v1/verification-inbox/${verification.id}/events`)
          .set('x-api-key', API_KEY),
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Message shape — status_updated
  // ────────────────────────────────────────────────────────────

  describe('status_updated event shape', () => {
    it('emits a status_updated event after approve, with correct shape', async () => {
      const verification = await seedVerification();

      const eventPromise = nextEvent(sseService);

      await auth(
        request(app.getHttpServer())
          .post(`/api/v1/verification-inbox/${verification.id}/approve`)
          .send({}),
      ).expect(200);

      const msg = await eventPromise;
      const data = JSON.parse(msg.data as string) as Record<string, unknown>;

      expect(msg.type).toBe('status_updated');
      expect(typeof msg.id).toBe('string');
      expect((msg.id as string).startsWith(verification.id)).toBe(true);
      expect(data['verificationId']).toBe(verification.id);
      expect(data['previousStatus']).toBe('pending_review');
      expect(data['newStatus']).toBe('approved');
      expect(typeof data['reviewerId']).toBe('string');
      expect(typeof data['timestamp']).toBe('string');
    });

    it('includes rejectionReason and nextStepMessage for reject', async () => {
      const verification = await seedVerification();

      const eventPromise = nextEvent(sseService);

      await auth(
        request(app.getHttpServer())
          .post(`/api/v1/verification-inbox/${verification.id}/reject`)
          .send({
            rejectionReason: 'Document expired',
            nextStepMessage: 'Please resubmit valid docs',
          }),
      ).expect(200);

      const msg = await eventPromise;
      const data = JSON.parse(msg.data as string) as Record<string, unknown>;

      expect(msg.type).toBe('status_updated');
      expect(data['newStatus']).toBe('rejected');
      expect(data['rejectionReason']).toBe('Document expired');
      expect(data['nextStepMessage']).toBe('Please resubmit valid docs');
    });

    it('emits status_updated for needs_resubmission', async () => {
      const verification = await seedVerification();

      const eventPromise = nextEvent(sseService);

      await auth(
        request(app.getHttpServer())
          .post(
            `/api/v1/verification-inbox/${verification.id}/request-resubmission`,
          )
          .send({
            rejectionReason: 'Expired',
            nextStepMessage: 'Resubmit',
          }),
      ).expect(200);

      const msg = await eventPromise;
      const data = JSON.parse(msg.data as string) as Record<string, unknown>;

      expect(data['newStatus']).toBe('needs_resubmission');
    });
  });

  // ────────────────────────────────────────────────────────────
  // Message shape — note_added
  // ────────────────────────────────────────────────────────────

  describe('note_added event shape', () => {
    it('emits a note_added event after addInternalNote, with correct shape', async () => {
      const verification = await seedVerification();

      const eventPromise = nextEvent(sseService);

      await auth(
        request(app.getHttpServer())
          .post(`/api/v1/verification-inbox/${verification.id}/notes`)
          .send({ content: 'Integration test note', category: 'follow_up' }),
      ).expect(201);

      const msg = await eventPromise;
      const data = JSON.parse(msg.data as string) as Record<string, unknown>;

      expect(msg.type).toBe('note_added');
      expect(data['verificationId']).toBe(verification.id);
      expect(typeof data['noteId']).toBe('string');
      expect(typeof data['authorId']).toBe('string');
      expect(typeof data['timestamp']).toBe('string');
    });

    it('includes category in the note_added payload when provided', async () => {
      const verification = await seedVerification();

      const eventPromise = nextEvent(sseService);

      await auth(
        request(app.getHttpServer())
          .post(`/api/v1/verification-inbox/${verification.id}/notes`)
          .send({ content: 'Escalating this case', category: 'escalation' }),
      ).expect(201);

      const msg = await eventPromise;
      const data = JSON.parse(msg.data as string) as Record<string, unknown>;

      expect(data['category']).toBe('escalation');
    });
  });

  // ────────────────────────────────────────────────────────────
  // Scoped stream filtering
  // ────────────────────────────────────────────────────────────

  describe('scoped stream', () => {
    it('scoped stream only delivers events for the watched verification', async () => {
      const [target, other] = await Promise.all([
        seedVerification(),
        seedVerification(),
      ]);

      // Subscribe to the scoped stream BEFORE triggering mutations.
      const eventPromise = nextEvent(sseService, target.id);

      // Approve 'other' first — should NOT reach the scoped stream.
      await auth(
        request(app.getHttpServer())
          .post(`/api/v1/verification-inbox/${other.id}/approve`)
          .send({}),
      ).expect(200);

      // Approve 'target' — SHOULD reach the scoped stream.
      await auth(
        request(app.getHttpServer())
          .post(`/api/v1/verification-inbox/${target.id}/approve`)
          .send({}),
      ).expect(200);

      const msg = await eventPromise;
      const data = JSON.parse(msg.data as string) as { verificationId: string };

      expect(data.verificationId).toBe(target.id);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Reconnect behaviour (no replay)
  // ────────────────────────────────────────────────────────────

  describe('reconnect behaviour', () => {
    it('re-connecting stream does not replay events emitted while disconnected', async () => {
      const verification = await seedVerification();

      // First connection — immediately disconnect.
      const firstSub = sseService.getStream().subscribe(() => {});
      firstSub.unsubscribe();

      // Trigger a mutation while disconnected — must NOT be replayed.
      await auth(
        request(app.getHttpServer())
          .post(`/api/v1/verification-inbox/${verification.id}/approve`)
          .send({}),
      ).expect(200);

      // Seed a second verification for the reconnected stream.
      const secondVerification = await seedVerification();

      // Reconnect and wait for the next event emitted AFTER reconnect.
      const eventPromise = nextEvent(sseService);

      await auth(
        request(app.getHttpServer())
          .post(
            `/api/v1/verification-inbox/${secondVerification.id}/approve`,
          )
          .send({}),
      ).expect(200);

      const msg = await eventPromise;
      const data = JSON.parse(msg.data as string) as { verificationId: string };

      // Must only see the event emitted after reconnect.
      expect(data.verificationId).toBe(secondVerification.id);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Connection count observable
  // ────────────────────────────────────────────────────────────

  describe('connection tracking', () => {
    it('getConnectionCount() reflects open streams', () => {
      const before = sseService.getConnectionCount();

      const sub1 = sseService.getStream().subscribe(() => {});
      const sub2 = sseService.getStream('v-scoped').subscribe(() => {});

      expect(sseService.getConnectionCount()).toBe(before + 2);

      sub1.unsubscribe();
      expect(sseService.getConnectionCount()).toBe(before + 1);

      sub2.unsubscribe();
      expect(sseService.getConnectionCount()).toBe(before);
    });
  });
});
