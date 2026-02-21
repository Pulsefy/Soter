import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';

describe('Error Handling (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror production setup
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });
    app.useGlobalInterceptors(new RequestIdInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const expectErrorEnvelope = (body: any) => {
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('path');
    expect(typeof body.code).toBe('number');
    expect(typeof body.message).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.path).toBe('string');
  };

  it('/test-error/generic-error (GET) - should return standardized error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/generic-error')
      .expect(500)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 500,
          message: 'This is a generic error',
          details: expect.objectContaining({
            error_type: 'Error',
          }),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/generic-error',
        });
      });
  });

  it('/test-error/bad-request (GET) - should return standardized error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/bad-request')
      .expect(400)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 400,
          message: 'This is a bad request error',
          details: expect.any(Object),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/bad-request',
        });
      });
  });

  it('/test-error/internal-server-error (GET) - should return standardized error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/internal-server-error')
      .expect(500)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 500,
          message: 'This is an internal server error',
          details: expect.any(Object),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/internal-server-error',
        });
      });
  });

  it('/test-error/unauthorized (GET) - should return 401 with standardized envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/unauthorized')
      .expect(401)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(401);
        expect(response.body.message).toBe('Authentication required');
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/forbidden (GET) - should return 403 with standardized envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/forbidden')
      .expect(403)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(403);
        expect(response.body.message).toBe('Access denied');
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/not-found (GET) - should return 404 with standardized envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/not-found')
      .expect(404)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(404);
        expect(response.body.message).toBe('Resource not found');
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/validation-error (POST) - should return standardized validation error response', () => {
    return request(app.getHttpServer())
      .post('/api/v1/test-error/validation-error')
      .send({ invalidField: 'invalid' })
      .expect(400)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(400);
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/prisma-error-simulation (GET) - should return standardized Prisma error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/prisma-error-simulation')
      .expect(409)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 409,
          message: 'Unique constraint violation',
          details: expect.objectContaining({
            target: ['email'],
            field: 'email',
          }),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/prisma-error-simulation',
        });
      });
  });

  it('should include X-Request-ID header in response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/bad-request')
      .expect(400)
      .then(response => {
        expect(response.headers).toHaveProperty('x-request-id');
        expect(response.headers['x-request-id']).toMatch(/^[A-Z0-9]+$/);
      });
  });

  it('should use provided X-Request-ID header as traceId', () => {
    const customTraceId = 'MY-CUSTOM-TRACE-ID';
    return request(app.getHttpServer())
      .get('/api/v1/test-error/bad-request')
      .set('X-Request-ID', customTraceId)
      .expect(400)
      .then(response => {
        expect(response.body.traceId).toBe(customTraceId);
        expect(response.headers['x-request-id']).toBe(customTraceId);
      });
  });
});
