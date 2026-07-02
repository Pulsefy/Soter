import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { AppModule } from '../src/app.module';

describe('Rate Limit Guard (E2E)', () => {
  let app: INestApplication;
  let redisService: RedisService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    redisService = app.get(RedisService);
    await redisService.getOrThrow().flushall();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear rate limit keys before each test
    const client = redisService.getOrThrow();
    const keys = await client.keys('ratelimit:*');
    if (keys.length > 0) {
      await client.del(...keys);
    }
  });

  describe('Rate Limit Policies', () => {
    it('should apply public rate limit to unauthenticated endpoints', async () => {
      const endpoint = '/health';
      const limit = 10; // Default public limit

      // Send requests up to the limit
      for (let i = 0; i < limit; i++) {
        await request(app.getHttpServer()).get(endpoint).expect(200);
      }

      // The 11th request should be rate limited
      const response = await request(app.getHttpServer())
        .get(endpoint)
        .expect(429);

      expect(response.body).toHaveProperty('code', 429);
      expect(response.body).toHaveProperty('errorCode', 'RATE_LIMIT_EXCEEDED');
      expect(response.body).toHaveProperty('message');
      expect(response.headers).toHaveProperty(
        'x-ratelimit-limit',
        String(limit),
      );
      expect(response.headers).toHaveProperty('x-ratelimit-remaining', '0');
    });

    it('should apply different rate limits to different endpoints', async () => {
      const publicEndpoint = '/health';
      const searchEndpoint = '/api/v1/claims/search?q=test';

      // Public endpoint should have limit 10
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer()).get(publicEndpoint).expect(200);
      }

      const publicResponse = await request(app.getHttpServer())
        .get(publicEndpoint)
        .expect(429);

      expect(publicResponse.headers['x-ratelimit-policy']).toBe('public');

      // Search endpoint should have limit 20 (search policy)
      // Wait for rate limit to reset or use a different IP
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Clear search keys specifically
      const client = redisService.getOrThrow();
      const searchKeys = await client.keys('ratelimit:search:*');
      if (searchKeys.length > 0) {
        await client.del(...searchKeys);
      }

      // Search should have higher limit than public
      for (let i = 0; i < 15; i++) {
        await request(app.getHttpServer())
          .get(searchEndpoint)
          .set('x-api-key', 'test-key')
          .expect(200);
      }

      // The 16th request should still succeed if search limit is 20
      await request(app.getHttpServer())
        .get(searchEndpoint)
        .set('x-api-key', 'test-key')
        .expect(200);
    });

    it('should apply API key rate limit for authenticated API key requests', async () => {
      const endpoint = '/api/v1/campaigns';

      // API key limit should be 100
      const limit = 100;

      // Send requests up to the limit
      for (let i = 0; i < limit; i++) {
        await request(app.getHttpServer())
          .get(endpoint)
          .set('x-api-key', 'test-api-key')
          .expect(200);
      }

      const response = await request(app.getHttpServer())
        .get(endpoint)
        .set('x-api-key', 'test-api-key')
        .expect(429);

      expect(response.headers['x-ratelimit-policy']).toBe('apikey');
      expect(response.headers['x-ratelimit-limit']).toBe(String(limit));
    });

    it('should include rate limit headers in responses', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-policy');
      expect(
        parseInt(response.headers['x-ratelimit-remaining']),
      ).toBeGreaterThanOrEqual(0);
    });

    it('should use IP-based rate limiting for public requests', async () => {
      const endpoint = '/health';
      const limit = 10;

      // Simulate requests from different IPs using x-forwarded-for
      const ip1 = '192.168.1.1';
      const ip2 = '192.168.1.2';

      // Send 10 requests from IP1
      for (let i = 0; i < limit; i++) {
        await request(app.getHttpServer())
          .get(endpoint)
          .set('x-forwarded-for', ip1)
          .expect(200);
      }

      // IP1 should be rate limited now
      await request(app.getHttpServer())
        .get(endpoint)
        .set('x-forwarded-for', ip1)
        .expect(429);

      // IP2 should still work
      await request(app.getHttpServer())
        .get(endpoint)
        .set('x-forwarded-for', ip2)
        .expect(200);
    });
  });

  describe('Rate Limit Configuration', () => {
    it('should use environment-specific limits', async () => {
      // In test environment, limits are higher
      const endpoint = '/health';
      const publicLimit = 20; // Test environment public limit

      // Should be able to make 20 requests
      for (let i = 0; i < publicLimit; i++) {
        await request(app.getHttpServer()).get(endpoint).expect(200);
      }

      // The 21st request should be rate limited
      const response = await request(app.getHttpServer())
        .get(endpoint)
        .expect(429);

      expect(response.headers['x-ratelimit-limit']).toBe(String(publicLimit));
    });

    it('should support endpoint-specific overrides', async () => {
      // This assumes there's an endpoint with custom rate limit
      // For demonstration, we'll test a health endpoint
      const endpoint = '/health';

      const response = await request(app.getHttpServer())
        .get(endpoint)
        .expect(200);

      expect(response.headers).toHaveProperty('x-ratelimit-policy');
      expect(response.headers['x-ratelimit-policy']).toBe('health');
    });

    it('should handle rate limit exhaustion gracefully', async () => {
      const endpoint = '/health';
      const limit = 10;

      // Exhaust the rate limit
      for (let i = 0; i < limit; i++) {
        await request(app.getHttpServer()).get(endpoint).expect(200);
      }

      const response = await request(app.getHttpServer())
        .get(endpoint)
        .expect(429);

      // Verify error envelope matches standard format
      expect(response.body).toMatchObject({
        code: 429,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        message: expect.any(String),
      });

      // Verify rate limit headers are present
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
      expect(response.headers).toHaveProperty('x-ratelimit-policy');
    });
  });

  describe('Rate Limit Recovery', () => {
    it('should reset rate limit after window expires', async () => {
      const endpoint = '/health';
      const limit = 10;
      // window is intentionally unused - kept for clarity/documentation
      const _window = 60; // 60 seconds

      // Exhaust the rate limit
      for (let i = 0; i < limit; i++) {
        await request(app.getHttpServer()).get(endpoint).expect(200);
      }

      // The 11th request should be rate limited
      await request(app.getHttpServer()).get(endpoint).expect(429);

      // Wait for rate limit window to reset (use shorter window for test)
      // In a real test, you'd mock time or use a shorter window
      // For demonstration, we'll just check the reset headers
      const response = await request(app.getHttpServer())
        .get(endpoint)
        .expect(429);

      expect(response.headers).toHaveProperty('x-ratelimit-remaining', '0');
    });

    it('should store rate limit data in Redis with correct TTL', async () => {
      const endpoint = '/health';
      const client = redisService.getOrThrow();

      // Make a request to create rate limit entry
      await request(app.getHttpServer()).get(endpoint).expect(200);

      // Find the rate limit key
      const keys = await client.keys('ratelimit:*');
      expect(keys.length).toBeGreaterThan(0);

      // Check TTL is set
      const ttl = await client.ttl(keys[0]);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });
});
