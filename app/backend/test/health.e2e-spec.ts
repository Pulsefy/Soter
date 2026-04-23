/**
 * E2E – Health & Readiness endpoints
 *
 * Covers:
 *  GET /api/v1/health        – simple health check (AppController, public)
 *  GET /api/v1/health/live   – liveness probe (HealthController, public)
 *  GET /api/v1/health/ready  – readiness probe (HealthController, public, checks DB)
 *
 * No external secrets or private keys required.
 */

import request from 'supertest';
import { createTestHarness, TestHarness } from './helpers/app-harness';

describe('Health endpoints (e2e)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/health – simple health check (AppController)
  // -------------------------------------------------------------------------

  describe('GET /api/v1/health', () => {
    it('returns 200 with status ok – no auth required', async () => {
      const res = await request(harness.server)
        .get('/api/v1/health')
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        service: 'backend',
      });
    });

    it('does not require an API key', async () => {
      // No x-api-key header – should still succeed (public endpoint)
      await request(harness.server).get('/api/v1/health').expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/health/live – liveness probe (HealthController)
  // -------------------------------------------------------------------------

  describe('GET /api/v1/health/live', () => {
    it('returns 200 with full liveness payload', async () => {
      const res = await request(harness.server)
        .get('/api/v1/health/live')
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        service: 'backend',
        version: expect.any(String),
        environment: expect.any(String),
        timestamp: expect.any(String),
        checks: {
          process: {
            status: 'up',
          },
        },
      });
    });

    it('timestamp is a valid ISO-8601 string', async () => {
      const res = await request(harness.server)
        .get('/api/v1/health/live')
        .expect(200);

      const ts = res.body.timestamp as string;
      expect(new Date(ts).toISOString()).toBe(ts);
    });

    it('process check includes pid and uptimeSeconds', async () => {
      const res = await request(harness.server)
        .get('/api/v1/health/live')
        .expect(200);

      const details = res.body.checks?.process?.details as Record<
        string,
        unknown
      >;
      expect(typeof details.pid).toBe('number');
      expect(typeof details.uptimeSeconds).toBe('number');
      expect(details.uptimeSeconds as number).toBeGreaterThanOrEqual(0);
    });

    it('does not require an API key', async () => {
      await request(harness.server).get('/api/v1/health/live').expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/health/ready – readiness probe (HealthController)
  // -------------------------------------------------------------------------

  describe('GET /api/v1/health/ready', () => {
    it('returns 200 when database is reachable', async () => {
      const res = await request(harness.server)
        .get('/api/v1/health/ready')
        .expect(200);

      expect(res.body).toMatchObject({
        ready: true,
        service: 'backend',
        checks: {
          database: { status: 'up' },
        },
      });
    });

    it('includes a valid ISO timestamp', async () => {
      const res = await request(harness.server)
        .get('/api/v1/health/ready')
        .expect(200);

      const ts = res.body.timestamp as string;
      expect(new Date(ts).toISOString()).toBe(ts);
    });

    it('stellarRpc check is present (skipped when STELLAR_RPC_URL not set)', async () => {
      const res = await request(harness.server)
        .get('/api/v1/health/ready')
        .expect(200);

      // In CI, STELLAR_RPC_URL is not set so the check is skipped – that is fine
      const stellarStatus = res.body.checks?.stellarRpc?.status as string;
      expect(['up', 'down', 'skipped']).toContain(stellarStatus);
    });

    it('does not require an API key', async () => {
      await request(harness.server).get('/api/v1/health/ready').expect(200);
    });
  });
});
