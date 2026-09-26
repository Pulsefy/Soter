import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Sandbox Guard E2E Tests
 *
 * Verifies that sandbox endpoints are:
 * 1. REJECTED (403 Forbidden) when SANDBOX_ENABLED is not set or not 'true'
 * 2. ACCEPTED when SANDBOX_ENABLED='true' (tested with appropriate auth)
 *
 * These tests ensure the sandbox feature is disabled by default and requires
 * explicit enablement, preventing accidental seed operations in production.
 */
describe('Sandbox Guard (E2E)', () => {
  let app: INestApplication;
  const originalSandboxEnabled = process.env.SANDBOX_ENABLED;

  beforeAll(async () => {
    // Ensure SANDBOX_ENABLED is NOT set before creating the module
    delete process.env.SANDBOX_ENABLED;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    // Restore original environment variable
    if (originalSandboxEnabled !== undefined) {
      process.env.SANDBOX_ENABLED = originalSandboxEnabled;
    } else {
      delete process.env.SANDBOX_ENABLED;
    }
    await app.close();
  });

  describe('Non-sandbox environments (SANDBOX_ENABLED not set)', () => {
    it('should reject POST /v1/admin/sandbox/seed with 403', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/admin/sandbox/seed')
        .set('x-api-key', 'dev-admin-key-000');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('SANDBOX_ENABLED=true');
    });

    it('should reject POST /v1/admin/sandbox/seed/tenant with 403', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/admin/sandbox/seed/tenant')
        .set('x-api-key', 'dev-admin-key-000');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('SANDBOX_ENABLED=true');
    });

    it('should reject POST /v1/admin/sandbox/seed/campaigns with 403', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/admin/sandbox/seed/campaigns')
        .set('x-api-key', 'dev-admin-key-000');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('SANDBOX_ENABLED=true');
    });

    it('should reject POST /v1/admin/sandbox/seed/claims with 403', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/admin/sandbox/seed/claims')
        .set('x-api-key', 'dev-admin-key-000');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('SANDBOX_ENABLED=true');
    });

    it('should reject DELETE /v1/admin/sandbox/seed with 403', async () => {
      const response = await request(app.getHttpServer())
        .delete('/v1/admin/sandbox/seed')
        .set('x-api-key', 'dev-admin-key-000');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('SANDBOX_ENABLED=true');
    });

    it('should reject sandbox endpoints even with valid admin API key', async () => {
      // This test ensures that having proper authentication is not enough;
      // the SANDBOX_ENABLED flag must also be explicitly set
      const response = await request(app.getHttpServer())
        .post('/v1/admin/sandbox/seed')
        .set('x-api-key', 'dev-admin-key-000')
        .send({});

      expect(response.status).toBe(403);
    });
  });

  describe('Non-sandbox environments (SANDBOX_ENABLED set to false)', () => {
    let testApp: INestApplication;

    beforeAll(async () => {
      process.env.SANDBOX_ENABLED = 'false';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      testApp = moduleFixture.createNestApplication();
      await testApp.init();
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('should reject POST /v1/admin/sandbox/seed with 403 when SANDBOX_ENABLED=false', async () => {
      const response = await request(testApp.getHttpServer())
        .post('/v1/admin/sandbox/seed')
        .set('x-api-key', 'dev-admin-key-000');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('SANDBOX_ENABLED=true');
    });
  });

  describe('Non-sandbox environments (SANDBOX_ENABLED set to invalid value)', () => {
    let testApp: INestApplication;

    beforeAll(async () => {
      process.env.SANDBOX_ENABLED = 'yes'; // Invalid value (must be exactly 'true')

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      testApp = moduleFixture.createNestApplication();
      await testApp.init();
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('should reject POST /v1/admin/sandbox/seed with 403 when SANDBOX_ENABLED=yes', async () => {
      const response = await request(testApp.getHttpServer())
        .post('/v1/admin/sandbox/seed')
        .set('x-api-key', 'dev-admin-key-000');

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('SANDBOX_ENABLED=true');
    });
  });

  describe('Sandbox environment (SANDBOX_ENABLED=true)', () => {
    let testApp: INestApplication;

    beforeAll(async () => {
      process.env.SANDBOX_ENABLED = 'true';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      testApp = moduleFixture.createNestApplication();
      await testApp.init();
    });

    afterAll(async () => {
      await testApp.close();
    });

    it('should allow POST /v1/admin/sandbox/seed/tenant when enabled', async () => {
      const response = await request(testApp.getHttpServer())
        .post('/v1/admin/sandbox/seed/tenant')
        .set('x-api-key', 'dev-admin-key-000');

      // Should not be 403 (may be 200/201 or other success code)
      expect(response.status).not.toBe(403);
    });

    it('should allow POST /v1/admin/sandbox/seed/campaigns when enabled', async () => {
      // Seed tenant first to ensure campaigns have a valid ngoId
      await request(testApp.getHttpServer())
        .post('/v1/admin/sandbox/seed/tenant')
        .set('x-api-key', 'dev-admin-key-000');

      const response = await request(testApp.getHttpServer())
        .post('/v1/admin/sandbox/seed/campaigns')
        .set('x-api-key', 'dev-admin-key-000');

      // Should not be 403
      expect(response.status).not.toBe(403);
    });

    it('should allow DELETE /v1/admin/sandbox/seed when enabled', async () => {
      const response = await request(testApp.getHttpServer())
        .delete('/v1/admin/sandbox/seed')
        .set('x-api-key', 'dev-admin-key-000');

      // Should not be 403
      expect(response.status).not.toBe(403);
    });
  });
});
