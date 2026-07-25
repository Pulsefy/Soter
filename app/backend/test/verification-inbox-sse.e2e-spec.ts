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
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { VerificationInboxSseService } from '../src/verification/verification-inbox-sse.service';
import { MessageEvent } from '@nestjs/common';
import { App } from 'supertest/types';

const API_KEY = 'sse-inbox-e2e-test-key';

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
    return prisma.verificationRequest.create({ data: {} });
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

    it('opens the SSE stream with a valid API key (200, text/event-stream)', done => {
      const req = request(app.getHttpServer())
        .get('/api/v1/verification-inbox/events')
        .set('x-api-key', API_KEY)
        .buffer(false)
        .parse((_res, _cb) => {
          // Don't parse — we just want the headers
        });

      req.on('response', res => {
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        expect(res.headers['cache-control']).toMatch(/no-cache/);
        req.abort();
        done();
      });

      req.on('error', err => {
        // ECONNRESET / abort is expected when we call req.abort()
        if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
          done(err);
        } else {
          done();
        }
      });

      // Safety timeout — if the response never fires, fail fast.
      setTimeout(() => done(new Error('SSE response did not arrive')), 5000);
    });

    it('scoped endpoint returns 200 for an existing verification id', async done => {
      const verification = await seedVerification();

      const req = request(app.getHttpServer())
        .get(`/api/v1/verification-inbox/${verification.id}/events`)
        .set('x-api-key', API_KEY)
        .buffer(false)
        .parse((_res, _cb) => {});

      req.on('response', res => {
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        req.abort();
        done();
      });

      req.on('error', err => {
        if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
          done(err);
        } else {
          done();
        }
      });

      setTimeout(() => done(new Error('SSE response did not arrive')), 5000);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Message shape — status_updated
  // ────────────────────────────────────────────────────────────

  describe('status_updated event shape', () => {
    it('emits a status_updated event after approve, with correct shape', done => {
      seedVerification()
        .then(verification => {
          const sub = sseService.getStream().subscribe(msg => {
            sub.unsubscribe();

            const data = JSON.parse(msg.data as string) as Record<
              string,
              unknown
            >;

            // Event type
            expect(msg.type).toBe('status_updated');

            // Stable id format
            expect(typeof msg.id).toBe('string');
            expect((msg.id as string).startsWith(verification.id)).toBe(true);

            // Payload fields
            expect(data['verificationId']).toBe(verification.id);
            expect(data['previousStatus']).toBe('pending_review');
            expect(data['newStatus']).toBe('approved');
            expect(typeof data['reviewerId']).toBe('string');
            expect(typeof data['timestamp']).toBe('string');

            done();
          });

          return auth(
            request(app.getHttpServer())
              .post(`/api/v1/verification-inbox/${verification.id}/approve`)
              .send({}),
          ).expect(200);
        })
        .catch(done);
    });

    it('includes rejectionReason and nextStepMessage for reject', done => {
      seedVerification()
        .then(verification => {
          const sub = sseService.getStream().subscribe(msg => {
            sub.unsubscribe();

            const data = JSON.parse(msg.data as string) as Record<
              string,
              unknown
            >;

            expect(msg.type).toBe('status_updated');
            expect(data['newStatus']).toBe('rejected');
            expect(data['rejectionReason']).toBe('Document expired');
            expect(data['nextStepMessage']).toBe('Please resubmit valid docs');

            done();
          });

          return auth(
            request(app.getHttpServer())
              .post(`/api/v1/verification-inbox/${verification.id}/reject`)
              .send({
                rejectionReason: 'Document expired',
                nextStepMessage: 'Please resubmit valid docs',
              }),
          ).expect(200);
        })
        .catch(done);
    });

    it('emits status_updated for needs_resubmission', done => {
      seedVerification()
        .then(verification => {
          const sub = sseService.getStream().subscribe(msg => {
            sub.unsubscribe();

            const data = JSON.parse(msg.data as string) as Record<
              string,
              unknown
            >;

            expect(data['newStatus']).toBe('needs_resubmission');
            done();
          });

          return auth(
            request(app.getHttpServer())
              .post(
                `/api/v1/verification-inbox/${verification.id}/request-resubmission`,
              )
              .send({
                rejectionReason: 'Expired',
                nextStepMessage: 'Resubmit',
              }),
          ).expect(200);
        })
        .catch(done);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Message shape — note_added
  // ────────────────────────────────────────────────────────────

  describe('note_added event shape', () => {
    it('emits a note_added event after addInternalNote, with correct shape', done => {
      seedVerification()
        .then(verification => {
          const sub = sseService.getStream().subscribe(msg => {
            sub.unsubscribe();

            const data = JSON.parse(msg.data as string) as Record<
              string,
              unknown
            >;

            expect(msg.type).toBe('note_added');
            expect(data['verificationId']).toBe(verification.id);
            expect(typeof data['noteId']).toBe('string');
            expect(typeof data['authorId']).toBe('string');
            expect(typeof data['timestamp']).toBe('string');

            done();
          });

          return auth(
            request(app.getHttpServer())
              .post(`/api/v1/verification-inbox/${verification.id}/notes`)
              .send({ content: 'Integration test note', category: 'follow_up' }),
          ).expect(201);
        })
        .catch(done);
    });

    it('includes category in the note_added payload when provided', done => {
      seedVerification()
        .then(verification => {
          const sub = sseService.getStream().subscribe(msg => {
            sub.unsubscribe();

            const data = JSON.parse(msg.data as string) as Record<
              string,
              unknown
            >;
            expect(data['category']).toBe('escalation');
            done();
          });

          return auth(
            request(app.getHttpServer())
              .post(`/api/v1/verification-inbox/${verification.id}/notes`)
              .send({ content: 'Escalating this case', category: 'escalation' }),
          ).expect(201);
        })
        .catch(done);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Scoped stream filtering
  // ────────────────────────────────────────────────────────────

  describe('scoped stream', () => {
    it('scoped stream only delivers events for the watched verification', done => {
      Promise.all([seedVerification(), seedVerification()])
        .then(([target, other]) => {
          const received: string[] = [];

          const sub = sseService.getStream(target.id).subscribe(msg => {
            sub.unsubscribe();

            const data = JSON.parse(msg.data as string) as {
              verificationId: string;
            };
            received.push(data.verificationId);

            expect(received).toHaveLength(1);
            expect(received[0]).toBe(target.id);
            done();
          });

          // Approve 'other' first — should not reach the scoped stream.
          return auth(
            request(app.getHttpServer())
              .post(`/api/v1/verification-inbox/${other.id}/approve`)
              .send({}),
          )
            .expect(200)
            .then(() =>
              // Approve 'target' — should reach the scoped stream.
              auth(
                request(app.getHttpServer())
                  .post(`/api/v1/verification-inbox/${target.id}/approve`)
                  .send({}),
              ).expect(200),
            );
        })
        .catch(done);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Reconnect behaviour (no replay)
  // ────────────────────────────────────────────────────────────

  describe('reconnect behaviour', () => {
    it('re-connecting stream does not replay events emitted while disconnected', done => {
      seedVerification()
        .then(verification => {
          // First connection — immediately disconnect.
          const firstSub = sseService.getStream().subscribe(() => {});
          firstSub.unsubscribe();

          // Trigger a mutation while disconnected.
          return auth(
            request(app.getHttpServer())
              .post(`/api/v1/verification-inbox/${verification.id}/approve`)
              .send({}),
          )
            .expect(200)
            .then(() => seedVerification())
            .then(secondVerification => {
              // Reconnect — second connection.
              const secondReceived: string[] = [];
              const secondSub = sseService.getStream().subscribe(msg => {
                secondSub.unsubscribe();
                const data = JSON.parse(msg.data as string) as {
                  verificationId: string;
                };
                secondReceived.push(data.verificationId);

                // Must only see events emitted AFTER reconnect.
                expect(secondReceived).toHaveLength(1);
                expect(secondReceived[0]).toBe(secondVerification.id);
                done();
              });

              return auth(
                request(app.getHttpServer())
                  .post(
                    `/api/v1/verification-inbox/${secondVerification.id}/approve`,
                  )
                  .send({}),
              ).expect(200);
            });
        })
        .catch(done);
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
