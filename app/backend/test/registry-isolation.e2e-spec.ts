import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * #1181 — Explicit Multi-Tenant Isolation Tests for the Registry Endpoints
 *
 * Adversarial suite: two independent organisations (Org A, Org B) are seeded.
 * Each org has its own operator API key. Every entity-linking endpoint is
 * exercised with a cross-org key to confirm:
 *
 *   1. Denials return HTTP 403 consistently.
 *   2. The error body exposes { error, message } only — no internal IDs,
 *      no foreign-org data, no registry content.
 *   3. The same key can successfully operate on its *own* org's data (200/201).
 */
describe('Registry Multi-Tenant Isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Shared identifiers set up in beforeEach
  let orgAId: string;
  let orgBId: string;
  let orgAKey: string;
  let orgBKey: string;
  let campaignAId: string;
  let campaignBId: string;
  let claimAId: string;
  let claimBId: string;
  let verificationAId: string;
  let verificationBId: string;
  let linkAId: string; // entity link owned by Org A (pending_review so PATCH can act on it)
  let linkBId: string; // entity link owned by Org B (pending_review)

  const base = '/api/v1/entity-linking';

  // ─── App bootstrap ──────────────────────────────────────────────────────────

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
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

  beforeEach(async () => {
    // Tear down in dependency order
    await prisma.entityLink.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.verificationRequest.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.organization.deleteMany();

    // ── Two organisations ─────────────────────────────────────────────────────
    const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
    const orgB = await prisma.organization.create({ data: { name: 'Org B' } });
    orgAId = orgA.id;
    orgBId = orgB.id;

    // ── One operator API key per org (non-admin, so org-scoped) ──────────────
    orgAKey = 'test-key-org-a';
    orgBKey = 'test-key-org-b';

    await prisma.apiKey.create({
      data: { key: orgAKey, role: 'operator', orgId: orgAId },
    });
    await prisma.apiKey.create({
      data: { key: orgBKey, role: 'operator', orgId: orgBId },
    });

    // ── Campaigns ─────────────────────────────────────────────────────────────
    const campA = await prisma.campaign.create({
      data: { name: 'Camp A', budget: 5000, orgId: orgAId },
    });
    const campB = await prisma.campaign.create({
      data: { name: 'Camp B', budget: 5000, orgId: orgBId },
    });
    campaignAId = campA.id;
    campaignBId = campB.id;

    // ── Claims (linked to campaigns) ─────────────────────────────────────────
    const claimA = await prisma.claim.create({
      data: { campaignId: campaignAId, amount: 100, recipientRef: 'r-a' },
    });
    const claimB = await prisma.claim.create({
      data: { campaignId: campaignBId, amount: 100, recipientRef: 'r-b' },
    });
    claimAId = claimA.id;
    claimBId = claimB.id;

    // ── Verification requests (direct orgId) ─────────────────────────────────
    const verA = await prisma.verificationRequest.create({
      data: { orgId: orgAId },
    });
    const verB = await prisma.verificationRequest.create({
      data: { orgId: orgBId },
    });
    verificationAId = verA.id;
    verificationBId = verB.id;

    // ── Entity links (pending_review so PATCH review endpoint has targets) ───
    const linkA = await prisma.entityLink.create({
      data: {
        sourceType: 'campaign',
        sourceId: campaignAId,
        extractedName: 'Org A Entity',
        entityType: 'organization',
        confidenceScore: 0.4, // below auto-accept → pending_review
        matchMethod: 'fuzzy',
        reviewStatus: 'pending_review',
        isActive: false,
        queuedAt: new Date(),
      },
    });
    const linkB = await prisma.entityLink.create({
      data: {
        sourceType: 'campaign',
        sourceId: campaignBId,
        extractedName: 'Org B Entity',
        entityType: 'organization',
        confidenceScore: 0.4,
        matchMethod: 'fuzzy',
        reviewStatus: 'pending_review',
        isActive: false,
        queuedAt: new Date(),
      },
    });
    linkAId = linkA.id;
    linkBId = linkB.id;
  });

  afterEach(async () => {
    await prisma.entityLink.deleteMany();
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.verificationRequest.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.organization.deleteMany();
  });

  // ─── Helper: assert denial is non-leaking ────────────────────────────────

  function assertNonLeakingDenial(body: Record<string, unknown>) {
    // Must have standard error envelope properties
    expect(body).toHaveProperty('message');
    expect(
      body.code === 403 ||
        body.statusCode === 403 ||
        body.errorCode === 'FORBIDDEN' ||
        body.error === 'Forbidden',
    ).toBe(true);

    // Must NOT expose internal IDs or org names
    const bodyStr = JSON.stringify(body).toLowerCase();
    expect(bodyStr).not.toContain('org a');
    expect(bodyStr).not.toContain('org b');
    expect(bodyStr).not.toContain(orgAId.toLowerCase());
    expect(bodyStr).not.toContain(orgBId.toLowerCase());
    expect(bodyStr).not.toContain(campaignBId.toLowerCase());
    expect(bodyStr).not.toContain(campaignAId.toLowerCase());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /entity-linking/link — write isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /entity-linking/link — write isolation', () => {
    it('allows orgA key to create a link for its own campaign', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/link`)
        .set('x-api-key', orgAKey)
        .send({
          sourceType: 'campaign',
          sourceId: campaignAId,
          extractedName: 'Own Entity',
          entityType: 'organization',
          confidenceScore: 0.95,
          matchMethod: 'exact',
        });

      expect(res.status).toBe(201);
    });

    it('denies orgA key from creating a link on orgB campaign', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/link`)
        .set('x-api-key', orgAKey)
        .send({
          sourceType: 'campaign',
          sourceId: campaignBId, // Org B's campaign
          extractedName: 'Stolen Entity',
          entityType: 'organization',
          confidenceScore: 0.95,
          matchMethod: 'exact',
        });

      expect(res.status).toBe(403);
      assertNonLeakingDenial(res.body as Record<string, unknown>);
    });

    it('denies orgA key from creating a link on orgB claim', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/link`)
        .set('x-api-key', orgAKey)
        .send({
          sourceType: 'claim',
          sourceId: claimBId, // Org B's claim
          extractedName: 'Stolen Entity',
          entityType: 'location',
          confidenceScore: 0.9,
          matchMethod: 'fuzzy',
        });

      expect(res.status).toBe(403);
      assertNonLeakingDenial(res.body as Record<string, unknown>);
    });

    it('denies orgA key from creating a link on orgB verification', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/link`)
        .set('x-api-key', orgAKey)
        .send({
          sourceType: 'verification',
          sourceId: verificationBId, // Org B's verification
          extractedName: 'Stolen Entity',
          entityType: 'project',
          confidenceScore: 0.9,
          matchMethod: 'fuzzy',
        });

      expect(res.status).toBe(403);
      assertNonLeakingDenial(res.body as Record<string, unknown>);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /entity-linking/campaign/:id — read isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /entity-linking/campaign/:id — read isolation', () => {
    it('allows orgA key to read its own campaign links', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/campaign/${campaignAId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('denies orgA key from reading orgB campaign links', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/campaign/${campaignBId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(403);
      assertNonLeakingDenial(res.body as Record<string, unknown>);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /entity-linking/claim/:id — read isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /entity-linking/claim/:id — read isolation', () => {
    it('allows orgA key to read its own claim links', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/claim/${claimAId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('denies orgA key from reading orgB claim links', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/claim/${claimBId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(403);
      assertNonLeakingDenial(res.body as Record<string, unknown>);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /entity-linking/verification/:id — read isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /entity-linking/verification/:id — read isolation', () => {
    it('allows orgA key to read its own verification links', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/verification/${verificationAId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('denies orgA key from reading orgB verification links', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/verification/${verificationBId}`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(403);
      assertNonLeakingDenial(res.body as Record<string, unknown>);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /entity-linking/links — list scoping
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /entity-linking/links — list scoping', () => {
    it('returns only orgA links to orgA key — does not expose orgB data', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/links`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');

      const data = res.body.data as Array<{ sourceId: string }>;
      const sourceIds = data.map(l => l.sourceId);

      // Org A's own link (campaign A) may appear
      // Org B's link (campaign B) must NOT appear
      expect(sourceIds).not.toContain(campaignBId);
    });

    it('returns only orgB links to orgB key — does not expose orgA data', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/links`)
        .set('x-api-key', orgBKey);

      expect(res.status).toBe(200);

      const data = res.body.data as Array<{ sourceId: string }>;
      const sourceIds = data.map(l => l.sourceId);

      expect(sourceIds).not.toContain(campaignAId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /entity-linking/review-queue — queue scoping
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /entity-linking/review-queue — queue scoping', () => {
    it('returns only orgA queue items to orgA key', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/review-queue`)
        .set('x-api-key', orgAKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');

      const data = res.body.data as Array<{ sourceId: string; id: string }>;
      const sourceIds = data.map(l => l.sourceId);
      const ids = data.map(l => l.id);

      // Org B's link source must NOT appear in Org A's queue view
      expect(sourceIds).not.toContain(campaignBId);
      expect(ids).not.toContain(linkBId);
    });

    it('returns only orgB queue items to orgB key', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/review-queue`)
        .set('x-api-key', orgBKey);

      expect(res.status).toBe(200);

      const data = res.body.data as Array<{ sourceId: string; id: string }>;
      const ids = data.map(l => l.id);

      expect(ids).not.toContain(linkAId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PATCH /entity-linking/review/:id — write isolation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PATCH /entity-linking/review/:id — write isolation', () => {
    it('allows orgA key to review its own pending link', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${base}/review/${linkAId}`)
        .set('x-api-key', orgAKey)
        .send({ action: 'accept' });

      expect(res.status).toBe(200);
    });

    it('denies orgA key from reviewing orgB pending link', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${base}/review/${linkBId}`)
        .set('x-api-key', orgAKey)
        .send({ action: 'accept' });

      expect(res.status).toBe(403);
      assertNonLeakingDenial(res.body as Record<string, unknown>);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Denial response shape — consistency contract
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Denial response shape — information-non-leaking contract', () => {
    it('cross-org 403 bodies contain error + message only, no internal data', async () => {
      const endpoints = [
        () =>
          request(app.getHttpServer())
            .get(`${base}/campaign/${campaignBId}`)
            .set('x-api-key', orgAKey),
        () =>
          request(app.getHttpServer())
            .get(`${base}/claim/${claimBId}`)
            .set('x-api-key', orgAKey),
        () =>
          request(app.getHttpServer())
            .get(`${base}/verification/${verificationBId}`)
            .set('x-api-key', orgAKey),
        () =>
          request(app.getHttpServer())
            .patch(`${base}/review/${linkBId}`)
            .set('x-api-key', orgAKey)
            .send({ action: 'reject' }),
      ];

      for (const endpoint of endpoints) {
        const res = await endpoint();
        expect(res.status).toBe(403);

        const body = res.body as Record<string, unknown>;
        assertNonLeakingDenial(body);

        // Must not contain any keys beyond the standard envelope
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
        const bodyKeys = Object.keys(body);
        for (const key of bodyKeys) {
          expect(allowedKeys).toContain(key);
        }
      }
    });
  });
});
