/**
 * E2E – Queue Monitoring & Dead Letter Queue endpoints
 *
 * Covers:
 *  GET  /api/v1/jobs/status        – raw queue counts
 *  GET  /api/v1/jobs/health        – aggregated health summary
 *  GET  /api/v1/jobs/dead-letter   – DLQ records list
 *
 * BullMQ queues are mocked so no Redis instance is required in CI.
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

const E2E_API_KEY = 'e2e-jobs-admin-key';

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

describe('Queue monitoring endpoints (e2e)', () => {
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
        description: 'E2E jobs monitoring test key',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /jobs/status
  // -------------------------------------------------------------------------

  describe('GET /api/v1/jobs/status', () => {
    it('returns 200 with counts for all three queues', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/status')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      for (const queueName of ['verification', 'notifications', 'onchain']) {
        expect(res.body).toHaveProperty(queueName);
        const q = res.body[queueName] as Record<string, unknown>;
        expect(q.name).toBe(queueName);
        expect(typeof q.waiting).toBe('number');
        expect(typeof q.active).toBe('number');
        expect(typeof q.completed).toBe('number');
        expect(typeof q.failed).toBe('number');
        expect(typeof q.delayed).toBe('number');
        expect(typeof q.failureRate).toBe('number');
        expect(typeof q.degraded).toBe('boolean');
      }
    });

    it('failureRate is between 0 and 1', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/status')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      for (const queueName of ['verification', 'notifications', 'onchain']) {
        const rate = (res.body[queueName] as { failureRate: number })
          .failureRate;
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    });

    it('returns 401 without API key', async () => {
      await request(server).get('/api/v1/jobs/status').expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /jobs/health
  // -------------------------------------------------------------------------

  describe('GET /api/v1/jobs/health', () => {
    it('returns 200 with overall health status', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/health')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body).toMatchObject({
        status: expect.stringMatching(/^(healthy|degraded|critical)$/),
        queues: expect.any(Object),
        deadLetter: expect.any(Object),
        checkedAt: expect.any(String),
      });
    });

    it('checkedAt is a valid ISO-8601 timestamp', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/health')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      const ts = res.body.checkedAt as string;
      expect(new Date(ts).toISOString()).toBe(ts);
    });

    it('deadLetter section has expected shape', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/health')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      const dlq = res.body.deadLetter as Record<string, unknown>;
      for (const key of [
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
      ]) {
        expect(typeof dlq[key]).toBe('number');
        expect(dlq[key] as number).toBeGreaterThanOrEqual(0);
      }
    });

    it('queues section contains all three domain queues', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/health')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body.queues).toHaveProperty('verification');
      expect(res.body.queues).toHaveProperty('notifications');
      expect(res.body.queues).toHaveProperty('onchain');
    });

    it('returns healthy status when all queues have zero failures', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/health')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      // With mocked queues returning 0 for all counts, status should be healthy
      expect(res.body.status).toBe('healthy');
    });

    it('returns 401 without API key', async () => {
      await request(server).get('/api/v1/jobs/health').expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /jobs/dead-letter
  // -------------------------------------------------------------------------

  describe('GET /api/v1/jobs/dead-letter', () => {
    it('returns 200 with stats, waiting, and failed arrays', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/dead-letter')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body).toMatchObject({
        stats: expect.any(Object),
        waiting: expect.any(Array),
        failed: expect.any(Array),
        retrievedAt: expect.any(String),
      });
    });

    it('accepts a limit query parameter', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/dead-letter?limit=10')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect((res.body.waiting as unknown[]).length).toBeLessThanOrEqual(10);
      expect((res.body.failed as unknown[]).length).toBeLessThanOrEqual(10);
    });

    it('returns empty arrays when DLQ is empty', async () => {
      const res = await request(server)
        .get('/api/v1/jobs/dead-letter')
        .set('x-api-key', E2E_API_KEY)
        .expect(200);

      expect(res.body.waiting).toEqual([]);
      expect(res.body.failed).toEqual([]);
    });

    it('returns 401 without API key', async () => {
      await request(server).get('/api/v1/jobs/dead-letter').expect(401);
    });
  });
});
