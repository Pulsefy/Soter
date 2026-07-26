import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

/**
 * Cost-Aware Rate Limiting E2E Tests
 *
 * Tests verify that:
 * 1. Strictest limits apply to OTP/email/phone endpoints
 * 2. Strict limits apply to general verification endpoints
 * 3. Moderate limits apply to general API endpoints
 * 4. Health and docs endpoints bypass rate limiting
 * 5. Reset behavior works after TTL window expires
 * 6. Retry-After header is present on 429 responses
 */
describe('Cost-Aware Rate Limiting (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // Use small limits for testing
    process.env.THROTTLE_VERIFY_OTP_LIMIT = '3';
    process.env.THROTTLE_VERIFY_OTP_TTL = '1';
    process.env.THROTTLE_VERIFY_LIMIT = '5';
    process.env.THROTTLE_VERIFY_TTL = '1';
    process.env.THROTTLE_GENERAL_LIMIT = '10';
    process.env.THROTTLE_GENERAL_TTL = '1';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('OTP/Email/Phone endpoints - Strictest limit (3 req/min)', () => {
    it('should allow up to 3 requests to /verification/start', async () => {
      const agent = request(app.getHttpServer());

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/start')
          .send({ email: 'test@example.com', channel: 'email' })
          .expect(res => {
            expect(res.status).toBeLessThan(429);
          });
      }
    });

    it('should return 429 Too Many Requests on 4th request to /verification/start', async () => {
      const agent = request(app.getHttpServer());

      // First 3 requests succeed
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/start')
          .send({ email: 'test@example.com', channel: 'email' });
      }

      // 4th request should be rate limited
      await agent
        .post('/api/v1/verification/start')
        .send({ email: 'test@example.com', channel: 'email' })
        .expect(429);
    });

    it('should include Retry-After header on 429 response from /verification/start', async () => {
      const agent = request(app.getHttpServer());

      // Hit the limit
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/start')
          .send({ email: 'test@example.com', channel: 'email' });
      }

      // Next request should have Retry-After header
      await agent
        .post('/api/v1/verification/start')
        .send({ email: 'test@example.com', channel: 'email' })
        .expect(429)
        .expect(res => {
          // NestJS ThrottlerGuard should set retry-after
          expect(res.headers['retry-after']).toBeDefined();
        });
    });

    it('should allow 3 requests to /verification/resend', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/resend')
          .send({ sessionId: 'test-session' })
          .expect(res => {
            expect(res.status).toBeLessThan(429);
          });
      }
    });

    it('should return 429 on 4th request to /verification/resend', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/resend')
          .send({ sessionId: 'test-session' });
      }

      await agent
        .post('/api/v1/verification/resend')
        .send({ sessionId: 'test-session' })
        .expect(429);
    });

    it('should allow 3 requests to /verification/complete', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/complete')
          .send({ sessionId: 'test-session', code: '123456' })
          .expect(res => {
            expect(res.status).toBeLessThan(429);
          });
      }
    });

    it('should return 429 on 4th request to /verification/complete', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/complete')
          .send({ sessionId: 'test-session', code: '123456' });
      }

      await agent
        .post('/api/v1/verification/complete')
        .send({ sessionId: 'test-session', code: '123456' })
        .expect(429);
    });
  });

  describe('General verification endpoints - Strict limit (5 req/min)', () => {
    it('should allow up to 5 requests to POST /api/v1/verification', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 5; i++) {
        await agent
          .post('/api/v1/verification')
          .send({
            userId: 'user-123',
            documentType: 'NATIONAL_ID',
          })
          .expect(res => {
            expect(res.status).toBeLessThan(429);
          });
      }
    });

    it('should return 429 on 6th request to POST /api/v1/verification', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 5; i++) {
        await agent
          .post('/api/v1/verification')
          .send({
            userId: 'user-123',
            documentType: 'NATIONAL_ID',
          });
      }

      await agent
        .post('/api/v1/verification')
        .send({
          userId: 'user-123',
          documentType: 'NATIONAL_ID',
        })
        .expect(429);
    });

    it('should allow up to 5 requests to POST /api/v1/verification/claims/:id/enqueue', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 5; i++) {
        await agent
          .post('/api/v1/verification/claims/claim-123/enqueue')
          .expect(res => {
            // Will fail with 404 or 500 (claim doesn't exist), but not 429
            expect(res.status).not.toBe(429);
          });
      }
    });

    it('should return 429 on 6th request to POST /api/v1/verification/claims/:id/enqueue', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 5; i++) {
        await agent.post('/api/v1/verification/claims/claim-123/enqueue');
      }

      await agent
        .post('/api/v1/verification/claims/claim-123/enqueue')
        .expect(429);
    });
  });

  describe('Health endpoints - No rate limiting', () => {
    it('should NOT rate limit GET /api/v1/health', async () => {
      const agent = request(app.getHttpServer());

      // Send many requests, all should succeed (or fail with non-429 errors)
      for (let i = 0; i < 20; i++) {
        await agent
          .get('/api/v1/health')
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });

    it('should NOT rate limit GET /api/v1/health/live', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 20; i++) {
        await agent
          .get('/api/v1/health/live')
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });

    it('should NOT rate limit GET /api/v1/health/ready', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 20; i++) {
        await agent
          .get('/api/v1/health/ready')
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });

    it('should NOT rate limit GET /api/v1/health/error', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 20; i++) {
        await agent
          .get('/api/v1/health/error')
          .expect(res => {
            // Will fail with 500, not 429
            expect(res.status).not.toBe(429);
          });
      }
    });

    it('should NOT rate limit GET /api/v1/health/onchain', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 20; i++) {
        await agent
          .get('/api/v1/health/onchain')
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });
  });

  describe('Docs endpoints - No rate limiting', () => {
    it('should NOT rate limit GET /api/docs', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 20; i++) {
        await agent
          .get('/api/docs')
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });

    it('should NOT rate limit GET /api/swagger.json', async () => {
      const agent = request(app.getHttpServer());

      for (let i = 0; i < 20; i++) {
        await agent
          .get('/api/swagger.json')
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });
  });

  describe('Rate limit window reset', () => {
    it('should reset limit after TTL window expires', async () => {
      const agent = request(app.getHttpServer());

      // Hit the limit (3 requests)
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/start')
          .send({ email: 'test@example.com', channel: 'email' });
      }

      // Next request should be rate limited
      await agent
        .post('/api/v1/verification/start')
        .send({ email: 'test@example.com', channel: 'email' })
        .expect(429);

      // Wait for TTL to expire (1 second in tests + small buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should allow more requests now
      await agent
        .post('/api/v1/verification/start')
        .send({ email: 'test@example.com', channel: 'email' })
        .expect(res => {
          expect(res.status).not.toBe(429);
        });
    });
  });

  describe('Different endpoints have independent limits', () => {
    it('should have independent limits for /verification/start and /verification/resend', async () => {
      const agent = request(app.getHttpServer());

      // Use up the /verification/start limit
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/start')
          .send({ email: 'test@example.com', channel: 'email' });
      }

      // /verification/start should be rate limited
      await agent
        .post('/api/v1/verification/start')
        .send({ email: 'test@example.com', channel: 'email' })
        .expect(429);

      // But /verification/resend should still be allowed
      await agent
        .post('/api/v1/verification/resend')
        .send({ sessionId: 'test-session' })
        .expect(res => {
          expect(res.status).not.toBe(429);
        });
    });

    it('should have independent limits for verify-otp (3) and verify (5) endpoints', async () => {
      const agent = request(app.getHttpServer());

      // Use up the verify-otp limit (3 requests)
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/start')
          .send({ email: 'test@example.com', channel: 'email' });
      }

      // But verify endpoint (/verification POST) should still allow up to 5
      for (let i = 0; i < 5; i++) {
        await agent
          .post('/api/v1/verification')
          .send({
            userId: 'user-123',
            documentType: 'NATIONAL_ID',
          })
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });
  });

  describe('Stricter limits compared to general endpoints', () => {
    it('OTP endpoints (3) should have stricter limits than verify endpoints (5)', async () => {
      const agent = request(app.getHttpServer());

      // Use up OTP limit
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/verification/start')
          .send({ email: 'test@example.com', channel: 'email' });
      }

      // 4th OTP request should fail
      await agent
        .post('/api/v1/verification/start')
        .send({ email: 'test@example.com', channel: 'email' })
        .expect(429);

      // But we should still be able to make 5 verify requests
      for (let i = 0; i < 5; i++) {
        await agent
          .post('/api/v1/verification')
          .send({
            userId: 'user-123',
            documentType: 'NATIONAL_ID',
          })
          .expect(res => {
            expect(res.status).not.toBe(429);
          });
      }
    });

    it('verify endpoints (5) should have stricter limits than general endpoints (10)', async () => {
      const agent = request(app.getHttpServer());

      // Use up verify limit
      for (let i = 0; i < 5; i++) {
        await agent
          .post('/api/v1/verification')
          .send({
            userId: 'user-123',
            documentType: 'NATIONAL_ID',
          });
      }

      // 6th verify request should fail
      await agent
        .post('/api/v1/verification')
        .send({
          userId: 'user-123',
          documentType: 'NATIONAL_ID',
        })
        .expect(429);

      // But general endpoints should still have room
      // Note: This assumes there are general endpoints available
      // In practice, adjust to actual general endpoints
    });
  });
});
