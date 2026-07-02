import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ErrorResponseDto } from '../src/common/dto/error-response.dto';

describe('Error Envelope (E2E)', () => {
  let app: INestApplication;
  // _prisma is intentionally unused - kept for potential future use
  let _prisma: PrismaService;

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
    _prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Error Envelope Structure', () => {
    it('should return standard error envelope for 404 Not Found', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/claims/non-existent-id')
        .expect(404);

      const body = response.body as ErrorResponseDto;

      expect(body).toHaveProperty('code', 404);
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');
      expect(body).toHaveProperty('errorCode');
      expect(body.errorCode).toBe('NOT_FOUND');
      expect(typeof body.code).toBe('number');
      expect(typeof body.message).toBe('string');
      expect(typeof body.timestamp).toBe('string');
    });

    it('should return standard error envelope for 400 Validation Error', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .send({})
        .expect(400);

      const body = response.body as ErrorResponseDto;

      expect(body).toHaveProperty('code', 400);
      expect(body).toHaveProperty('errorCode', 'VALIDATION_ERROR');
      expect(body).toHaveProperty('details');
    });

    it('should return standard error envelope for 401 Unauthorized', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/campaigns')
        .expect(401);

      const body = response.body as ErrorResponseDto;

      expect(body).toHaveProperty('code', 401);
      expect(body).toHaveProperty('errorCode', 'UNAUTHORIZED');
      expect(body.message).toBeDefined();
    });

    it('should include traceId/correlationId when available', async () => {
      const correlationId = 'test-correlation-123';

      const response = await request(app.getHttpServer())
        .get('/api/v1/claims/non-existent')
        .set('x-correlation-id', correlationId)
        .expect(404);

      const body = response.body as ErrorResponseDto;

      expect(body).toHaveProperty('correlationId');
      expect(body.correlationId).toBe(correlationId);
    });

    it('should return standard error envelope for 409 Conflict', async () => {
      // Try to create a resource with duplicate unique field
      const response = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('x-api-key', 'test-key')
        .send({ name: 'duplicate-key' })
        .expect(409);

      const body = response.body as ErrorResponseDto;

      expect(body).toHaveProperty('code', 409);
      expect(body).toHaveProperty('errorCode', 'CONFLICT');
      expect(body.message).toBeDefined();
    });

    it('should return standard error envelope for 500 Internal Server Error', async () => {
      // Force a 500 error by hitting an endpoint that throws
      const response = await request(app.getHttpServer())
        .get('/api/v1/test-error')
        .expect(500);

      const body = response.body as ErrorResponseDto;

      expect(body).toHaveProperty('code', 500);
      expect(body).toHaveProperty('errorCode', 'INTERNAL_SERVER_ERROR');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');
    });

    it('should return standard error envelope for 429 Rate Limit', async () => {
      // Send multiple requests to trigger rate limit
      const requests = Array(10)
        .fill(null)
        .map(() =>
          request(app.getHttpServer())
            .get('/api/v1/health')
            .set('x-api-key', 'test-key'),
        );

      // Find the first 429 response
      for (const req of requests) {
        const response = await req;
        if (response.status === 429) {
          const body = response.body as ErrorResponseDto;
          expect(body).toHaveProperty('code', 429);
          expect(body).toHaveProperty('errorCode', 'RATE_LIMIT_EXCEEDED');
          expect(body.message).toBeDefined();
          break;
        }
      }
    });
  });

  describe('Error Envelope Consistency', () => {
    it('should have consistent error envelope across all endpoints', async () => {
      const errorEndpoints = [
        {
          url: '/api/v1/claims/invalid-id',
          method: 'GET',
          expectedStatus: 404,
        },
        {
          url: '/api/v1/campaigns/invalid',
          method: 'GET',
          expectedStatus: 404,
        },
        {
          url: '/api/v1/verification/invalid',
          method: 'GET',
          expectedStatus: 404,
        },
        { url: '/api/v1/session/invalid', method: 'GET', expectedStatus: 404 },
      ];

      for (const { url, method, expectedStatus } of errorEndpoints) {
        const response = await request(app.getHttpServer())
          [
            method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
          ](url)
          .expect(expectedStatus);

        const body = response.body as ErrorResponseDto;

        // All error responses should have these fields
        expect(body).toHaveProperty('code');
        expect(body).toHaveProperty('message');
        expect(body).toHaveProperty('timestamp');
        expect(body).toHaveProperty('path');
        expect(body).toHaveProperty('errorCode');

        // Status code should match
        expect(body.code).toBe(expectedStatus);

        // Error code should be present and non-empty
        expect(body.errorCode).toBeTruthy();
        expect(typeof body.errorCode).toBe('string');
      }
    });

    it('should include validation error details for 422 errors', async () => {
      // Create a claim with invalid data
      const response = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .send({
          // Missing required fields
          campaignId: 'not-a-uuid',
          amount: 'invalid-number',
        })
        .expect(422);

      const body = response.body as ErrorResponseDto;

      expect(body.code).toBe(422);
      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(body.details).toBeDefined();
      expect(body.details?.errors).toBeDefined();
    });

    it('should handle multiple error types consistently', async () => {
      // Test 404 - Not Found
      const notFoundRes = await request(app.getHttpServer())
        .get('/api/v1/claims/non-existent-id')
        .expect(404);
      expect(notFoundRes.body.errorCode).toBe('NOT_FOUND');

      // Test 401 - Unauthorized
      const unauthRes = await request(app.getHttpServer())
        .get('/api/v1/campaigns')
        .expect(401);
      expect(unauthRes.body.errorCode).toBe('UNAUTHORIZED');

      // Test 400 - Bad Request
      const badReqRes = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .send({ invalid: 'data' })
        .expect(400);
      expect(badReqRes.body.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('Error Envelope Field Types', () => {
    it('should have correct field types', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/claims/non-existent')
        .expect(404);

      const body = response.body as ErrorResponseDto;

      expect(typeof body.code).toBe('number');
      expect(typeof body.message).toBe('string');
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.path).toBe('string');
      expect(typeof body.errorCode).toBe('string');
      expect(Date.parse(body.timestamp as string)).not.toBeNaN();
    });

    it('should handle errors with details', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .send({
          campaignId: 'invalid-uuid',
          amount: -100,
        })
        .expect(422);

      const body = response.body as ErrorResponseDto;

      expect(body.details).toBeDefined();
      expect(body.details?.errors).toBeDefined();
      expect(Array.isArray(body.details?.errors)).toBe(true);
    });
  });
});
