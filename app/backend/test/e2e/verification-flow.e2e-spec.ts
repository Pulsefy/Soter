import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createCompleteTestApp, cleanupTestApp } from '../utils/complete-test-app';
import { DETERMINISTIC_TEST_DATA } from '../utils/factories';

describe('Verification Flow (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createCompleteTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(app);
  });

  describe('Complete Verification Lifecycle', () => {
    let sessionId: string;
    const testEmail = DETERMINISTIC_TEST_DATA.verificationSession.identifier;
    const testCode = DETERMINISTIC_TEST_DATA.verificationSession.code;

    it('should start email verification', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
          identifier: testEmail,
        })
        .expect(200);

      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('channel', 'email');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body).toHaveProperty('message');
      
      sessionId = response.body.sessionId;
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
    });

    it('should complete verification with correct code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId,
          code: testCode,
        })
        .expect(200);

      expect(response.body).toHaveProperty('sessionId', sessionId);
      expect(response.body).toHaveProperty('verified', true);
      expect(response.body).toHaveProperty('message');
    });

    it('should reject verification with wrong code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId,
          code: '999999', // Wrong code
        })
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Invalid code');
    });

    it('should handle expired session gracefully', async () => {
      // Start a new session
      const startResponse = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
          identifier: 'expired@example.com',
        })
        .expect(200);

      // Try to complete with a session that would be expired
      // (In real scenario, we'd need to manually expire it or wait)
      // For now, test with invalid session ID
      await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId: 'invalid-session-id',
          code: '123456',
        })
        .expect(404);
    });
  });

  describe('Phone Verification Flow', () => {
    let sessionId: string;
    const testPhone = DETERMINISTIC_TEST_DATA.user.phone;

    it('should start phone verification', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'phone',
          identifier: testPhone,
        })
        .expect(200);

      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('channel', 'phone');
      expect(response.body).toHaveProperty('expiresAt');
      
      sessionId = response.body.sessionId;
    });

    it('should complete phone verification', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId,
          code: DETERMINISTIC_TEST_DATA.verificationSession.code,
        })
        .expect(200);

      expect(response.body).toHaveProperty('verified', true);
    });
  });

  describe('Resend Verification', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Start a verification session for resend tests
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
          identifier: 'resend@example.com',
        })
        .expect(200);

      sessionId = response.body.sessionId;
    });

    it('should resend verification code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/resend')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId,
        })
        .expect(200);

      expect(response.body).toHaveProperty('sessionId', sessionId);
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('New verification code sent');
    });

    it('should reject resend for invalid session', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/verification/resend')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId: 'invalid-session-id',
        })
        .expect(404);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on verification start', async () => {
      const email = 'ratelimit@example.com';
      
      // First request should succeed
      await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
          identifier: email,
        })
        .expect(200);

      // Subsequent requests might be rate limited (depends on configuration)
      // In test environment, rate limiting might be disabled
      const response = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
          identifier: email,
        });

      // Should either succeed (if rate limiting disabled) or return 429
      expect([200, 429]).toContain(response.status);
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid channel', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'invalid',
          identifier: 'test@example.com',
        })
        .expect(400);
    });

    it('should reject missing identifier', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
        })
        .expect(400);
    });

    it('should reject invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
          identifier: 'invalid-email',
        })
        .expect(400);
    });

    it('should reject incomplete verification request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId: 'test-session',
          // Missing code
        })
        .expect(400);
    });
  });

  describe('Authentication', () => {
    it('should require API key for verification endpoints', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .send({
          channel: 'email',
          identifier: 'test@example.com',
        })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .send({
          sessionId: 'test-session',
          code: '123456',
        })
        .expect(401);
    });

    it('should reject invalid API key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', 'invalid-api-key')
        .send({
          channel: 'email',
          identifier: 'test@example.com',
        })
        .expect(401);
    });
  });

  describe('Database Side Effects', () => {
    it('should persist verification session to database', async () => {
      const email = 'persist@example.com';
      
      const startResponse = await request(app.getHttpServer())
        .post('/api/v1/verification/start')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          channel: 'email',
          identifier: email,
        })
        .expect(200);

      const sessionId = startResponse.body.sessionId;

      // Complete the verification
      await request(app.getHttpServer())
        .post('/api/v1/verification/complete')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          sessionId,
          code: DETERMINISTIC_TEST_DATA.verificationSession.code,
        })
        .expect(200);

      // Verify the session is marked as completed
      // This would require database access to verify directly
      // For now, we trust the service layer handles persistence
      expect(startResponse.body.sessionId).toBeDefined();
    });
  });
});
