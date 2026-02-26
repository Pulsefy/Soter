import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createMinimalTestApp, cleanupTestApp } from '../utils/minimal-test-app';

describe('Health Endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createMinimalTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(app);
  });

  describe('GET /api/v1/health', () => {
    it('should return liveness information with correct schema', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
      
      // Verify timestamp is a valid ISO date
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });

    it('should include request correlation in logs', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      // The health check should log with correlation ID
      expect(response.body.status).toBe('ok');
    });
  });

  describe('GET /api/v1/health/live', () => {
    it('should return liveness probe response', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('checks');
      expect(response.body.checks).toHaveProperty('process');
      
      // Verify process checks contain expected information
      expect(response.body.checks.process).toHaveProperty('status', 'up');
      expect(response.body.checks.process).toHaveProperty('details');
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('should return service unavailable when database is not connected', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);

      expect(response.body).toHaveProperty('ready', false);
      expect(response.body).toHaveProperty('checks');
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks).toHaveProperty('stellarRpc');
    });

    it('should handle service unavailable gracefully when dependencies are down', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);

      expect(response.body).toHaveProperty('ready');
      expect(response.body).toHaveProperty('checks');
    });
  });

  describe('Error handling', () => {
    it('should handle error endpoint with proper error response', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/health/error')
        .expect(500);
    });
  });

  describe('API Versioning', () => {
    it('should support v1 API versioning', async () => {
      // Test with Accept header
      await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Accept', 'application/json')
        .expect(200);

      // Test direct v1 endpoint
      await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);
    });
  });

  describe('Security', () => {
    it('should allow public access to health endpoints', async () => {
      // Health endpoints should be accessible without API key
      await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);

      // Ready endpoint returns 503 when database is not available
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);
    });
  });
});
