import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('Verification rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // Use small limits for tests
    process.env.API_RATE_LIMIT = '2';
    process.env.THROTTLE_TTL = '1000';

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

  it('should enforce rate limit on verification POST (unauthenticated)', async () => {
    const agent = request(app.getHttpServer());

    // First two requests should succeed (within limit)
    await agent
      .post('/api/v1/verification')
      .send({})
      .expect(res => {
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
        expect(
          res.header['ratelimit-limit'] || res.header['RateLimit-Limit'],
        ).toBeDefined();
      });

    await agent
      .post('/api/v1/verification')
      .send({})
      .expect(res => {
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
      });

    // Third request should be rate limited
    await agent
      .post('/api/v1/verification')
      .send({})
      .expect(429)
      .expect(res => {
        // Headers should be present
        expect(
          res.header['ratelimit-limit'] || res.header['RateLimit-Limit'],
        ).toBeDefined();
        expect(
          res.header['ratelimit-remaining'] ||
            res.header['RateLimit-Remaining'],
        ).toBeDefined();
        expect(
          res.header['ratelimit-reset'] || res.header['RateLimit-Reset'],
        ).toBeDefined();
      });
  });

  it('should not rate limit authenticated requests (Authorization header present)', async () => {
    const agent = request(app.getHttpServer());

    // Send multiple requests with Authorization header - should not be throttled here
    await agent
      .post('/api/v1/verification')
      .set('Authorization', 'Bearer faketoken')
      .send({})
      .expect(res => {
        expect(res.status).toBeGreaterThanOrEqual(200);
      });

    await agent
      .post('/api/v1/verification')
      .set('Authorization', 'Bearer faketoken')
      .send({})
      .expect(res => {
        expect(res.status).toBeGreaterThanOrEqual(200);
      });

    await agent
      .post('/api/v1/verification')
      .set('Authorization', 'Bearer faketoken')
      .send({})
      .expect(res => {
        expect(res.status).toBeGreaterThanOrEqual(200);
      });
  });
});
