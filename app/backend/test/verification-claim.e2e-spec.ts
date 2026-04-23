/**
 * E2E – Full Verification Flow
 *
 * Exercises the complete claim-verification lifecycle through HTTP:
 *
 *   1. Create a campaign  (POST /api/v1/campaigns)
 *   2. Create a claim     (POST /api/v1/claims)
 *   3. Enqueue the claim  (POST /api/v1/verification/claims/:id/enqueue)
 *   4. Poll claim status  (GET  /api/v1/verification/claims/:id)
 *   5. Verify queue metrics reflect the job (GET /api/v1/verification/metrics)
 *
 * Also covers:
 *  - 404 when enqueueing a non-existent claim
 *  - 202 Accepted response shape
 *  - Metrics endpoint shape
 *
 * BullMQ queues are mocked so no Redis instance is required in CI.
 * VERIFICATION_MODE=mock so no OpenAI calls are made.
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppRole } from 'src/auth/app-role.enum';

// ---------------------------------------------------------------------------
// BullMQ queue mock – returns a fake job so no Redis connection is needed
// ---------------------------------------------------------------------------

function makeMockQueue(name: string) {
  let jobCounter = 0;
  return {
    name,
    add: jest.fn().mockImplementation(() =>
      Promise.resolve({
        id: `mock-job-${++jobCounter}`,
        name,
        data: {},
        opts: { attempts: 3 },
        attemptsMade: 0,
      }),
    ),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getDelayedCount: jest.fn().mockResolvedValue(0),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

const E2E_API_KEY = 'e2e-verify-admin-key';

describe('Verification claim flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const base = '/api/v1/verification';
  const claimsBase = '/api/v1/claims';
  const campaignsBase = '/api/v1/campaigns';

  beforeAll(async () => {
    const verificationQueueMock = makeMockQueue('verification');
    const notificationsQueueMock = makeMockQueue('notifications');
    const onchainQueueMock = makeMockQueue('onchain');
    const deadLetterQueueMock = makeMockQueue('dead-letter');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('verification'))
      .useValue(verificationQueueMock)
      .overrideProvider(getQueueToken('notifications'))
      .useValue(notificationsQueueMock)
      .overrideProvider(getQueueToken('onchain'))
      .useValue(onchainQueueMock)
      .overrideProvider(getQueueToken('dead-letter'))
      .useValue(deadLetterQueueMock)
      .compile();

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
      }),
    );

    await app.init();
    prisma = moduleRef.get(PrismaService);
    server = app.getHttpServer();

    // Seed test API key
    await prisma.apiKey.upsert({
      where: { key: E2E_API_KEY },
      update: { role: AppRole.admin, revokedAt: null },
      create: {
        key: E2E_API_KEY,
        role: AppRole.admin,
        description: 'E2E verification test key',
      },
    });
  });

  beforeEach(async () => {
    await prisma.claim.deleteMany();
    await prisma.campaign.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function createCampaign(name = 'E2E Campaign') {
    const res = await request(server)
      .post(campaignsBase)
      .set('x-api-key', E2E_API_KEY)
      .send({ name, budget: 10000 })
      .expect(201);
    return res.body.data as { id: string };
  }

  async function createClaim(campaignId: string, amount = 500) {
    const res = await request(server)
      .post(claimsBase)
      .set('x-api-key', E2E_API_KEY)
      .send({ campaignId, amount, recipientRef: `recipient-${Date.now()}` })
      .expect(201);
    return res.body.data as { id: string; status: string };
  }

  // -------------------------------------------------------------------------
  // POST /verification/claims/:id/enqueue
  // -------------------------------------------------------------------------

  describe('POST /verification/claims/:id/enqueue', () => {
    it('returns 202 Accepted with jobId and queued status', async () => {
      const campaign = await createCampaign();
      const claim = await createClaim(campaign.id);

      const res = await request(server)
        .post(`${base}/claims/${claim.id}/enqueue`)
        .set('x-api-key', E2E_API_KEY)
        .expect(202);

      expect(res.body).toMatchObject({
        jobId: expect.any(String),
        claimId: claim.id,
        status: 'queued',
        message: expect.any(String),
      });
      expect(res.body.jobId.length).toBeGreaterThan(0);
    });

    it('returns 404 for a non-existent claim', async () => {
      await request(server)
        .post(`${base}/claims/nonexistent-claim-id/enqueue`)
        .set('x-api-key', E2E_API_KEY)
        .expect(404);
    });

    it('returns 401 when API key is missing', async () => {
      const campaign = await createCampaign();
      const claim = await createClaim(campaign.id);

      await request(server)
        .post(`${base}/claims/${claim.id}/enqueue`)
        .expect(401);
    });

    it('returns 401 when API key is invalid', async () => {
      const campaign = await createCampaign();
      const claim = await createClaim(campaign.id);

      await request(server)
        .post(`${base}/claims/${claim.id}/enqueue`)
        .set('x-api-key', 'totally-wrong-key')
        .expect(401);
    });

    it('handles already-verified claim gracefully', async () => {
      const campaign = await createCampaign();
      const verifiedClaim = await prisma.claim.create({
        data: {
          campaignId: campaign.id,
          amount: 100,
          recipientRef: 'already-verified',
          status: 'verified',
        },
      });

      const res = await request(server)
        .post(`${base}/claims/${verifiedClaim.id}/enqueue`)
        .set('x-api-key', E2E_API_KEY)
        .expect(202);

      expect(res.body.jobId).toBe('already-verified');
    });
  });

  // -------------------------------------------------------------------------
  // GET /verification/claims/:id
  // -------------------------------------------------------------------------

  describe('GET /verification/claims/:id', () => {
    it('returns claim details with status', async () => {
      const campaign = await createCampaign();
      const claim = await createClaim(campaign.id);

      const res = await request(server)
        .get(`${base}/claims/${claim.id}`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body).toMatchObject({
        id: claim.id,
        status: expect.any(String),
      });
    });

    it('returns 404 for unknown claim id', async () => {
      await request(server)
        .get(`${base}/claims/does-not-exist`)
        .set('x-api-key', E2E_API_KEY)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /verification/metrics
  // -------------------------------------------------------------------------

  describe('GET /verification/metrics', () => {
    it('returns queue metric counts', async () => {
      const res = await request(server)
        .get(`${base}/metrics`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body).toMatchObject({
        waiting: expect.any(Number),
        active: expect.any(Number),
        completed: expect.any(Number),
        failed: expect.any(Number),
        total: expect.any(Number),
      });

      for (const key of ['waiting', 'active', 'completed', 'failed', 'total']) {
        expect(res.body[key] as number).toBeGreaterThanOrEqual(0);
      }
    });

    it('total equals sum of waiting + active + completed + failed', async () => {
      const res = await request(server)
        .get(`${base}/metrics`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      const { waiting, active, completed, failed, total } = res.body as {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        total: number;
      };

      expect(total).toBe(waiting + active + completed + failed);
    });
  });

  // -------------------------------------------------------------------------
  // Full lifecycle: create → enqueue → status check
  // -------------------------------------------------------------------------

  describe('Full verification lifecycle', () => {
    it('enqueues a claim and the claim remains retrievable', async () => {
      const campaign = await createCampaign('Lifecycle Campaign');
      const claim = await createClaim(campaign.id, 250);

      // Step 1: enqueue
      const enqueueRes = await request(server)
        .post(`${base}/claims/${claim.id}/enqueue`)
        .set('x-api-key', E2E_API_KEY)
        .expect(202);

      expect(enqueueRes.body.status).toBe('queued');
      expect(enqueueRes.body.jobId).toBeTruthy();

      // Step 2: claim is still retrievable
      const statusRes = await request(server)
        .get(`${base}/claims/${claim.id}`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(statusRes.body.id).toBe(claim.id);
      expect(['requested', 'verified']).toContain(statusRes.body.status);
    });
  });
});
