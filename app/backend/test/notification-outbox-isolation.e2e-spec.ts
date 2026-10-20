import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { OutboxController } from 'src/notifications/outbox.controller';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationBackpressureService } from 'src/notifications/notification-backpressure.service';
import { AuditService } from 'src/audit/audit.service';
import { MetricsService } from 'src/observability/metrics/metrics.service';
import { LoggerService } from 'src/logger/logger.service';
import { ApiKeyGuard } from 'src/common/guards/api-key.guard';
import { RolesGuard } from 'src/auth/roles.guard';
import { AllExceptionsFilter } from 'src/common/filters/http-exception.filter';

/**
 * #1386 — Cross-Organization Isolation Tests for the Notification Outbox
 *
 * Adversarial suite: two independent organisations (Org A, Org B) each own
 * notification outbox records that contain recipient contact details and
 * claim-specific content. Every admin outbox endpoint is exercised with the
 * *other* organisation's operator key to confirm:
 *
 *   1. List endpoints only ever return the caller's own records.
 *   2. Single-record reads and replays of a foreign record are
 *      indistinguishable from a record that does not exist (404 with the
 *      standard error envelope) — no recipient, subject, message or foreign
 *      identifier is echoed back.
 *   3. Cross-org replay attempts leave the foreign record untouched and
 *      enqueue nothing.
 *   4. The same key can still read and replay its *own* organisation's
 *      records.
 *   5. Platform admins (no organisation context) keep platform-wide access.
 *
 * The module under test is assembled directly from the real
 * OutboxController/NotificationsService/Prisma layer plus the production
 * authentication guards and exception filter. AppModule is not imported here
 * because it currently fails to bootstrap for reasons unrelated to this issue
 * (`EMAIL_ADAPTER`/`SMS_ADAPTER` are injected by NotificationProcessor but
 * provided nowhere, and RecipientImportProcessor injects a ClaimsService that
 * ClaimsModule does not export), which prevents every AppModule-based e2e
 * suite — including the registry isolation suite — from running at all.
 * The notification queue is mocked so replay behaviour is deterministic.
 */
describe('Notification outbox cross-organization isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queueAdd: jest.Mock;

  let orgAId: string;
  let orgBId: string;
  let orgAKey: string;
  let orgBKey: string;
  let platformKey: string;

  let stuckAId: string;
  let deadLetterAId: string;
  let stuckBId: string;
  let deadLetterBId: string;

  const base = '/api/v1/notifications/outbox';

  // Distinctive markers so a leak is provable rather than inferred.
  const orgARecipient = 'alice-org-a@example.test';
  const orgBRecipient = 'bob-org-b@example.test';
  const orgASecret = 'ORG-A-CLAIM-SECRET-70001';
  const orgBSecret = 'ORG-B-CLAIM-SECRET-70002';

  // ─── App bootstrap ──────────────────────────────────────────────────────────

  beforeAll(async () => {
    queueAdd = jest.fn().mockResolvedValue({ id: 'replay-job-1' });

    const loggerMock = {
      getCorrelationId: jest.fn().mockReturnValue(undefined),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
      ],
      controllers: [OutboxController],
      providers: [
        NotificationsService,
        NotificationBackpressureService,
        {
          provide: getQueueToken('notifications'),
          useValue: { add: queueAdd },
        },
        { provide: LoggerService, useValue: loggerMock },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: MetricsService,
          useValue: {
            setGauge: jest.fn(),
            setNotificationDeadLetterDepth: jest.fn(),
          },
        },
        // Real authentication/authorisation guards and error envelope.
        { provide: APP_GUARD, useClass: ApiKeyGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
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
        transformOptions: { enableImplicitConversion: true },
        errorHttpStatusCode: 422,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Seed / teardown ────────────────────────────────────────────────────────

  async function teardown() {
    await prisma.notificationDeliveryAttempt.deleteMany();
    await prisma.notificationOutbox.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.organization.deleteMany();
  }

  beforeEach(async () => {
    queueAdd.mockClear();
    await teardown();

    // ── Two organisations ─────────────────────────────────────────────────────
    const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
    const orgB = await prisma.organization.create({ data: { name: 'Org B' } });
    orgAId = orgA.id;
    orgBId = orgB.id;

    // ── One operator API key per org, plus a platform admin key ─────────────
    orgAKey = 'outbox-key-org-a';
    orgBKey = 'outbox-key-org-b';
    platformKey = 'outbox-key-platform';

    await prisma.apiKey.create({
      data: { key: orgAKey, role: 'operator', orgId: orgAId },
    });
    await prisma.apiKey.create({
      data: { key: orgBKey, role: 'operator', orgId: orgBId },
    });
    await prisma.apiKey.create({ data: { key: platformKey, role: 'admin' } });

    // ── Outbox records ───────────────────────────────────────────────────────
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const stuckA = await prisma.notificationOutbox.create({
      data: {
        type: 'email',
        recipient: orgARecipient,
        subject: 'Org A stuck notification',
        message: orgASecret,
        status: 'pending',
        scheduledFor: anHourAgo,
        orgId: orgAId,
      },
    });
    const deadA = await prisma.notificationOutbox.create({
      data: {
        type: 'email',
        recipient: orgARecipient,
        subject: 'Org A dead-letter notification',
        message: orgASecret,
        status: 'dead_letter',
        scheduledFor: anHourAgo,
        orgId: orgAId,
      },
    });
    const stuckB = await prisma.notificationOutbox.create({
      data: {
        type: 'sms',
        recipient: orgBRecipient,
        subject: 'Org B stuck notification',
        message: orgBSecret,
        status: 'pending',
        scheduledFor: anHourAgo,
        orgId: orgBId,
      },
    });
    const deadB = await prisma.notificationOutbox.create({
      data: {
        type: 'sms',
        recipient: orgBRecipient,
        subject: 'Org B dead-letter notification',
        message: orgBSecret,
        status: 'dead_letter',
        scheduledFor: anHourAgo,
        orgId: orgBId,
      },
    });

    stuckAId = stuckA.id;
    deadLetterAId = deadA.id;
    stuckBId = stuckB.id;
    deadLetterBId = deadB.id;

    // ── Delivery attempts (carry the same contact/claim content) ────────────
    await prisma.notificationDeliveryAttempt.createMany({
      data: [
        {
          outboxId: stuckAId,
          attemptNumber: 1,
          outcome: 'failed',
          failureCategory: 'smtp',
          errorMessage: `${orgASecret} delivery failed`,
          startedAt: anHourAgo,
        },
        {
          outboxId: stuckBId,
          attemptNumber: 1,
          outcome: 'failed',
          failureCategory: 'sms',
          errorMessage: `${orgBSecret} delivery failed`,
          startedAt: anHourAgo,
        },
      ],
    });
  });

  afterEach(async () => {
    await teardown();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * A denial must be indistinguishable from "this record does not exist" and
   * must not echo any foreign content. Returns the normalised body so callers
   * can compare a foreign-id denial with a truly-missing-id denial.
   */
  function assertNonLeakingDenial(
    body: Record<string, unknown>,
    suppliedId: string,
  ) {
    expect(body.code).toBe(404);
    expect(body.errorCode).toBe('NOT_FOUND');

    const raw = JSON.stringify(body);
    expect(raw).not.toContain(orgARecipient);
    expect(raw).not.toContain(orgBRecipient);
    expect(raw).not.toContain(orgASecret);
    expect(raw).not.toContain(orgBSecret);
    expect(raw).not.toContain(orgAId);
    expect(raw).not.toContain(orgBId);

    // Standard error envelope only — no extra fields carrying foreign data.
    const allowedKeys = new Set([
      'code',
      'errorCode',
      'error',
      'message',
      'statusCode',
      'timestamp',
      'path',
      'traceId',
      'correlationId',
      'details',
    ]);
    for (const key of Object.keys(body)) {
      expect(allowedKeys).toContain(key);
    }

    // The only identifier present is the one the caller supplied itself.
    const normalised = { ...body };
    if (typeof normalised.message === 'string') {
      normalised.message = normalised.message.replace(suppliedId, '<supplied>');
      expect(normalised.message).toBe(
        'Outbox record with id "<supplied>" not found',
      );
    }
    if (typeof normalised.path === 'string') {
      normalised.path = normalised.path.replace(suppliedId, '<supplied>');
    }
    return normalised;
  }

  function idsOf(body: { data?: Array<{ id: string }> }) {
    return (body.data ?? []).map(item => item.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /notifications/outbox — stuck-record list isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /notifications/outbox — stuck list isolation', () => {
    it("returns only org A's stuck records to the org A key", async () => {
      const res = await request(app.getHttpServer())
        .get(base)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(stuckAId);
      expect(ids).not.toContain(stuckBId);
      expect(ids).not.toContain(deadLetterBId);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orgBRecipient);
      expect(raw).not.toContain(orgBSecret);
    });

    it("returns only org B's stuck records to the org B key", async () => {
      const res = await request(app.getHttpServer())
        .get(base)
        .set('x-api-key', orgBKey);

      expect(res.status).toBe(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(stuckBId);
      expect(ids).not.toContain(stuckAId);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orgARecipient);
      expect(raw).not.toContain(orgASecret);
    });

    it('keeps platform-wide visibility for admin keys (no org context)', async () => {
      const res = await request(app.getHttpServer())
        .get(base)
        .set('x-api-key', platformKey);

      expect(res.status).toBe(200);
      const ids = idsOf(res.body);
      expect(ids).toContain(stuckAId);
      expect(ids).toContain(stuckBId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /notifications/outbox/dead-letter — dead-letter list isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /notifications/outbox/dead-letter — list isolation', () => {
    it("returns only org A's dead-letter records to the org A key", async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/dead-letter`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      const items = res.body.data.items as Array<{ id: string }>;
      expect(items.map(item => item.id)).toContain(deadLetterAId);
      expect(items.map(item => item.id)).not.toContain(deadLetterBId);
      expect(items).toHaveLength(1);
      expect(res.body.data.total).toBe(1);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orgBRecipient);
      expect(raw).not.toContain(orgBSecret);
    });

    it('paginates within the caller organisation only', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/dead-letter?page=1&limit=1`)
        .set('x-api-key', orgBKey);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].id).toBe(deadLetterBId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /notifications/outbox/:id — single-record read isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /notifications/outbox/:id — read isolation', () => {
    it('allows the org A key to read its own outbox record', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/${stuckAId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(stuckAId);
      expect(res.body.data.recipient).toBe(orgARecipient);
    });

    it("denies the org A key reading org B's outbox record", async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/${stuckBId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(404);
      assertNonLeakingDenial(res.body, stuckBId);
    });

    it("denies the org B key reading org A's dead-letter record", async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/${deadLetterAId}`)
        .set('x-api-key', orgBKey);

      expect(res.status).toBe(404);
      assertNonLeakingDenial(res.body, deadLetterAId);
    });

    it('does not reveal whether a foreign record exists (same response as a missing id)', async () => {
      const foreign = await request(app.getHttpServer())
        .get(`${base}/${stuckBId}`)
        .set('x-api-key', orgAKey);
      const missing = await request(app.getHttpServer())
        .get(`${base}/does-not-exist-id`)
        .set('x-api-key', orgAKey);

      expect(foreign.status).toBe(missing.status);
      const foreignBody = assertNonLeakingDenial(foreign.body, stuckBId);
      const missingBody = assertNonLeakingDenial(
        missing.body,
        'does-not-exist-id',
      );

      // Same envelope keys, same message template.
      expect(Object.keys(foreignBody).sort()).toEqual(
        Object.keys(missingBody).sort(),
      );
      expect(foreignBody.message).toBe(missingBody.message);
      expect(foreignBody.errorCode).toBe(missingBody.errorCode);
    });

    it('allows admin keys to read across organisations', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/${stuckBId}`)
        .set('x-api-key', platformKey);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(stuckBId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /notifications/outbox/:id/attempts — delivery timeline isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /notifications/outbox/:id/attempts — timeline isolation', () => {
    it('allows the org A key to read its own attempt timeline', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/${stuckAId}/attempts`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].outboxId).toBe(stuckAId);
    });

    it("denies the org A key reading org B's attempt timeline", async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/${stuckBId}/attempts`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(404);
      assertNonLeakingDenial(res.body, stuckBId);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orgBSecret);
      expect(raw).not.toContain('delivery failed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /notifications/outbox/delivery-attempts — attempt list isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /notifications/outbox/delivery-attempts — list isolation', () => {
    it("returns only org A's delivery attempts to the org A key", async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/delivery-attempts`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      const outboxIds = (
        res.body.data.items as Array<{ outboxId: string }>
      ).map(item => item.outboxId);
      expect(outboxIds).toContain(stuckAId);
      expect(outboxIds).not.toContain(stuckBId);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orgBSecret);
    });

    it('does not leak foreign attempts when filtering by type', async () => {
      // Org B's stuck record is an SMS; org A owns no SMS attempt.
      const res = await request(app.getHttpServer())
        .get(`${base}/delivery-attempts?type=sms`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
      expect(res.body.data.total).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /notifications/outbox/dead-letter/:id/replay — replay isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /notifications/outbox/dead-letter/:id/replay — replay isolation', () => {
    it('allows the org A key to replay its own dead-letter record', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/dead-letter/${deadLetterAId}/replay`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(res.body.data.outboxId).toBe(deadLetterAId);
      expect(queueAdd).toHaveBeenCalledTimes(1);

      const record = await prisma.notificationOutbox.findUnique({
        where: { id: deadLetterAId },
      });
      expect(record?.status).toBe('enqueued');
      expect(record?.retryCount).toBe(1);
    });

    it("denies the org A key replaying org B's dead-letter record", async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/dead-letter/${deadLetterBId}/replay`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(404);
      assertNonLeakingDenial(res.body, deadLetterBId);

      // The foreign record is untouched and nothing was enqueued.
      const record = await prisma.notificationOutbox.findUnique({
        where: { id: deadLetterBId },
      });
      expect(record?.status).toBe('dead_letter');
      expect(record?.retryCount).toBe(0);
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('does not reveal whether a foreign record exists (same response as a missing id)', async () => {
      const foreign = await request(app.getHttpServer())
        .post(`${base}/dead-letter/${deadLetterBId}/replay`)
        .set('x-api-key', orgAKey);
      const missing = await request(app.getHttpServer())
        .post(`${base}/dead-letter/does-not-exist-id/replay`)
        .set('x-api-key', orgAKey);

      expect(foreign.status).toBe(missing.status);
      const foreignBody = assertNonLeakingDenial(foreign.body, deadLetterBId);
      const missingBody = assertNonLeakingDenial(
        missing.body,
        'does-not-exist-id',
      );
      expect(Object.keys(foreignBody).sort()).toEqual(
        Object.keys(missingBody).sort(),
      );
      expect(foreignBody.message).toBe(missingBody.message);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Role denial — consistent, non-leaking envelope
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Role denial — consistent non-leaking envelope', () => {
    it('rejects a key without an admin/operator role with a plain 403', async () => {
      const clientKey = 'outbox-key-org-a-client';
      await prisma.apiKey.create({
        data: { key: clientKey, role: 'client', orgId: orgAId },
      });

      const res = await request(app.getHttpServer())
        .get(`${base}/${stuckBId}`)
        .set('x-api-key', clientKey);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('FORBIDDEN');

      // Same non-leaking contract as the cross-org denial: no foreign content
      // (the id echoed in `path` is the one the caller supplied itself).
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orgBRecipient);
      expect(raw).not.toContain(orgBSecret);
      expect(raw).not.toContain(orgAId);
      expect(raw).not.toContain(orgBId);
      expect(res.body).not.toHaveProperty('data');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /notifications/outbox/dead-letter/replay — bulk replay isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /notifications/outbox/dead-letter/replay — bulk replay isolation', () => {
    it("replays only the caller's own records when foreign ids are mixed in", async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/dead-letter/replay`)
        .set('x-api-key', orgAKey)
        .send({ ids: [deadLetterAId, deadLetterBId] });

      expect(res.status).toBe(200);
      expect(res.body.data.replayed).toBe(1);
      expect(res.body.data.skipped).toBe(1);

      const own = await prisma.notificationOutbox.findUnique({
        where: { id: deadLetterAId },
      });
      const foreign = await prisma.notificationOutbox.findUnique({
        where: { id: deadLetterBId },
      });
      expect(own?.status).toBe('enqueued');
      expect(foreign?.status).toBe('dead_letter');
      expect(foreign?.retryCount).toBe(0);

      // Only the org A record reached the queue.
      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(queueAdd.mock.calls[0][1]).toEqual(
        expect.objectContaining({ recipient: orgARecipient }),
      );
    });

    it('skips every id when the caller tries to replay only foreign records', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/dead-letter/replay`)
        .set('x-api-key', orgAKey)
        .send({ ids: [deadLetterBId] });

      expect(res.status).toBe(200);
      expect(res.body.data.replayed).toBe(0);
      expect(res.body.data.skipped).toBe(1);
      expect(queueAdd).not.toHaveBeenCalled();

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orgBRecipient);
      expect(raw).not.toContain(orgBSecret);
      expect(raw).not.toContain(orgAId);
      expect(raw).not.toContain(orgBId);
    });
  });
});
