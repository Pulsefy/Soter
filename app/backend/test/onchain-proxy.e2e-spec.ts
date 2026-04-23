/**
 * E2E – Backend-to-Contract Proxy (Onchain / Aid Escrow)
 *
 * Exercises the AidEscrow REST endpoints that proxy calls to the Soroban
 * contract.  All tests run against the MockOnchainAdapter so no real
 * Stellar keys, RPC URLs, or contract IDs are required.
 *
 * BullMQ queues are mocked so no Redis instance is required in CI.
 *
 * Covers:
 *  POST /api/v1/onchain/aid-escrow/packages          – create aid package
 *  POST /api/v1/onchain/aid-escrow/packages/batch    – batch create
 *  GET  /api/v1/onchain/aid-escrow/packages/:id      – get package details
 *  GET  /api/v1/onchain/aid-escrow/stats             – aggregated stats
 *  POST /api/v1/onchain/aid-escrow/packages/:id/disburse – disburse
 *
 * No external secrets or private keys required.
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
// Shared test fixtures
// ---------------------------------------------------------------------------

const MOCK_RECIPIENT =
  'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ';
const MOCK_TOKEN =
  'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';
const MOCK_AMOUNT = '1000000000'; // 100 XLM in stroops
const EXPIRES_AT = Math.floor(Date.now() / 1000) + 86400 * 30; // 30 days

const base = '/api/v1/onchain/aid-escrow';
const E2E_API_KEY = 'e2e-onchain-admin-key';

function makeMockQueue(name: string) {
  return {
    name,
    add: jest.fn().mockResolvedValue({ id: `mock-job-${Date.now()}`, name }),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getDelayedCount: jest.fn().mockResolvedValue(0),
    getWaiting: jest.fn().mockResolvedValue([]),
    getFailed: jest.fn().mockResolvedValue([]),
    getJob: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe('Onchain / Aid Escrow proxy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('verification'))
      .useValue(makeMockQueue('verification'))
      .overrideProvider(getQueueToken('notifications'))
      .useValue(makeMockQueue('notifications'))
      .overrideProvider(getQueueToken('onchain'))
      .useValue(makeMockQueue('onchain'))
      .overrideProvider(getQueueToken('dead-letter'))
      .useValue(makeMockQueue('dead-letter'))
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
        description: 'E2E onchain test key',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /packages – create a single aid package
  // -------------------------------------------------------------------------

  describe('POST /packages', () => {
    it('creates an aid package and returns a transaction hash', async () => {
      const res = await request(server)
        .post(`${base}/packages`)
        .set('x-api-key', E2E_API_KEY)
        .send({
          packageId: `pkg-e2e-${Date.now()}`,
          recipientAddress: MOCK_RECIPIENT,
          amount: MOCK_AMOUNT,
          tokenAddress: MOCK_TOKEN,
          expiresAt: EXPIRES_AT,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        packageId: expect.any(String),
        transactionHash: expect.any(String),
        status: 'success',
        timestamp: expect.any(String),
      });

      // Transaction hash should be a 64-char hex string (mock format)
      expect(res.body.transactionHash).toMatch(/^[0-9A-F]{64}$/);
    });

    it('returns 400 when required fields are missing', async () => {
      await request(server)
        .post(`${base}/packages`)
        .set('x-api-key', E2E_API_KEY)
        .send({})
        .expect(400);
    });

    it('returns 401 without API key', async () => {
      await request(server)
        .post(`${base}/packages`)
        .send({
          packageId: 'pkg-no-auth',
          recipientAddress: MOCK_RECIPIENT,
          amount: MOCK_AMOUNT,
          tokenAddress: MOCK_TOKEN,
          expiresAt: EXPIRES_AT,
        })
        .expect(401);
    });

    it('metadata field is optional', async () => {
      const res = await request(server)
        .post(`${base}/packages`)
        .set('x-api-key', E2E_API_KEY)
        .send({
          packageId: `pkg-no-meta-${Date.now()}`,
          recipientAddress: MOCK_RECIPIENT,
          amount: MOCK_AMOUNT,
          tokenAddress: MOCK_TOKEN,
          expiresAt: EXPIRES_AT,
        })
        .expect(201);

      expect(res.body.status).toBe('success');
    });
  });

  // -------------------------------------------------------------------------
  // POST /packages/batch – batch create
  // -------------------------------------------------------------------------

  describe('POST /packages/batch', () => {
    it('creates multiple packages in one call', async () => {
      const res = await request(server)
        .post(`${base}/packages/batch`)
        .set('x-api-key', E2E_API_KEY)
        .send({
          recipientAddresses: [MOCK_RECIPIENT, MOCK_RECIPIENT],
          amounts: [MOCK_AMOUNT, MOCK_AMOUNT],
          tokenAddress: MOCK_TOKEN,
          expiresIn: 86400 * 30,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        packageIds: expect.any(Array),
        transactionHash: expect.any(String),
        status: 'success',
      });
      expect((res.body.packageIds as string[]).length).toBe(2);
    });

    it('returns 400 when recipients and amounts arrays have different lengths', async () => {
      await request(server)
        .post(`${base}/packages/batch`)
        .set('x-api-key', E2E_API_KEY)
        .send({
          recipientAddresses: [MOCK_RECIPIENT],
          amounts: [MOCK_AMOUNT, MOCK_AMOUNT], // mismatched
          tokenAddress: MOCK_TOKEN,
          expiresIn: 86400,
        })
        .expect(400);
    });

    it('returns 400 when body is empty', async () => {
      await request(server)
        .post(`${base}/packages/batch`)
        .set('x-api-key', E2E_API_KEY)
        .send({})
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /packages/:id – get package details
  // -------------------------------------------------------------------------

  describe('GET /packages/:id', () => {
    it('returns package details for any id (mock always succeeds)', async () => {
      const packageId = `pkg-get-${Date.now()}`;

      const res = await request(server)
        .get(`${base}/packages/${packageId}`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body).toMatchObject({
        package: {
          id: packageId,
          recipient: expect.any(String),
          amount: expect.any(String),
          token: expect.any(String),
          status: expect.any(String),
          createdAt: expect.any(Number),
          expiresAt: expect.any(Number),
        },
        timestamp: expect.any(String),
      });
    });

    it('returns 401 without API key', async () => {
      await request(server)
        .get(`${base}/packages/some-pkg`)
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /stats – aggregated statistics
  // -------------------------------------------------------------------------

  describe('GET /stats', () => {
    it('returns aggregated aid package statistics', async () => {
      const res = await request(server)
        .get(`${base}/stats`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body).toMatchObject({
        aggregates: {
          totalCommitted: expect.any(String),
          totalClaimed: expect.any(String),
          totalExpiredCancelled: expect.any(String),
        },
        timestamp: expect.any(String),
      });

      const { totalCommitted, totalClaimed, totalExpiredCancelled } =
        res.body.aggregates as Record<string, string>;
      expect(Number(totalCommitted)).toBeGreaterThanOrEqual(0);
      expect(Number(totalClaimed)).toBeGreaterThanOrEqual(0);
      expect(Number(totalExpiredCancelled)).toBeGreaterThanOrEqual(0);
    });

    it('returns 401 without API key', async () => {
      await request(server).get(`${base}/stats`).expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // POST /packages/:id/disburse – disburse a package
  // -------------------------------------------------------------------------

  describe('POST /packages/:id/disburse', () => {
    it('disburses a package and returns transaction details', async () => {
      const createRes = await request(server)
        .post(`${base}/packages`)
        .set('x-api-key', E2E_API_KEY)
        .send({
          packageId: `pkg-disburse-${Date.now()}`,
          recipientAddress: MOCK_RECIPIENT,
          amount: MOCK_AMOUNT,
          tokenAddress: MOCK_TOKEN,
          expiresAt: EXPIRES_AT,
        })
        .expect(201);

      const { packageId } = createRes.body as { packageId: string };

      const disburseRes = await request(server)
        .post(`${base}/packages/${packageId}/disburse`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(disburseRes.body).toMatchObject({
        packageId,
        transactionHash: expect.any(String),
        status: 'success',
        amountDisbursed: expect.any(String),
      });
    });

    it('returns 401 without API key', async () => {
      await request(server)
        .post(`${base}/packages/some-pkg/disburse`)
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // Full proxy round-trip: create → get → disburse
  // -------------------------------------------------------------------------

  describe('Full proxy round-trip', () => {
    it('create → get → disburse succeeds end-to-end', async () => {
      const packageId = `pkg-roundtrip-${Date.now()}`;

      // 1. Create
      const createRes = await request(server)
        .post(`${base}/packages`)
        .set('x-api-key', E2E_API_KEY)
        .send({
          packageId,
          recipientAddress: MOCK_RECIPIENT,
          amount: MOCK_AMOUNT,
          tokenAddress: MOCK_TOKEN,
          expiresAt: EXPIRES_AT,
        })
        .expect(201);

      expect(createRes.body.status).toBe('success');

      // 2. Get
      const getRes = await request(server)
        .get(`${base}/packages/${packageId}`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(getRes.body.package.id).toBe(packageId);

      // 3. Disburse
      const disburseRes = await request(server)
        .post(`${base}/packages/${packageId}/disburse`)
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(disburseRes.body.status).toBe('success');
      expect(disburseRes.body.transactionHash).toMatch(/^[0-9A-F]{64}$/);
    });
  });
});
