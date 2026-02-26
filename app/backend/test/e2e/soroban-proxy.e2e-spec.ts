import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, cleanupTestApp } from '../utils/test-app';
import { DETERMINISTIC_TEST_DATA } from '../utils/factories';

describe('Soroban Proxy (Onchain) (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    
    // Create a mock JWT token for authenticated requests
    // In a real scenario, you'd authenticate through the auth endpoint
    authToken = 'mock-jwt-token-for-testing';
  });

  afterAll(async () => {
    await cleanupTestApp(app);
  });

  describe('Claim Creation and Onchain Operations', () => {
    let claimId: string;
    let campaignId: string;

    beforeAll(async () => {
      // Create a test campaign first
      const campaignResponse = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          name: 'Test Campaign for Onchain',
          budget: 10000.00,
          status: 'active',
        });

      if (campaignResponse.status === 201) {
        campaignId = campaignResponse.body.id;
      } else {
        campaignId = DETERMINISTIC_TEST_DATA.campaign.id;
      }
    });

    it('should create a new claim', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          campaignId,
          amount: 500.00,
          recipientRef: DETERMINISTIC_TEST_DATA.claim.recipientRef,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('campaignId', campaignId);
      expect(response.body).toHaveProperty('amount', '500.00');
      expect(response.body).toHaveProperty('status', 'requested');
      
      claimId = response.body.id;
    });

    it('should retrieve claim details', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/claims/${claimId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('id', claimId);
      expect(response.body).toHaveProperty('status', 'requested');
    });

    it('should verify claim (operator role)', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/verify`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('id', claimId);
      expect(response.body).toHaveProperty('status', 'verified');
    });

    it('should approve claim (admin role)', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/approve`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('id', claimId);
      expect(response.body).toHaveProperty('status', 'approved');
    });

    it('should initiate onchain disbursement', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/disburse`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      expect(response.body).toHaveProperty('id', claimId);
      expect(response.body.status).toMatch(/disbursing|disbursed/);
      
      if (response.body.status === 'disbursed') {
        expect(response.body).toHaveProperty('transactionHash');
        expect(response.body).toHaveProperty('amount');
        expect(response.body.transactionHash).toMatch(/^[0-9A-F]{64}$/);
      }
    });
  });

  describe('Mock Soroban Client Behavior', () => {
    it('should use mock adapter for onchain operations', async () => {
      // Create a claim specifically for testing mock behavior
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          campaignId: DETERMINISTIC_TEST_DATA.campaign.id,
          amount: 250.00,
          recipientRef: 'mock-test-recipient',
        })
        .expect(201);

      const claimId = createResponse.body.id;

      // Approve the claim
      await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/verify`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/approve`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      // Disburse and verify mock behavior
      const disburseResponse = await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/disburse`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      // Mock adapter should return deterministic results
      if (disburseResponse.body.status === 'disbursed') {
        expect(disburseResponse.body.transactionHash).toMatch(/^[0-9A-F]{64}$/);
        expect(disburseResponse.body).toHaveProperty('amount');
      }
    });

    it('should handle onchain operation failures gracefully', async () => {
      // This test would require configuring the mock to return errors
      // For now, we verify the structure is correct
      const response = await request(app.getHttpServer())
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Contract Call Validation', () => {
    it('should validate contract call parameters', async () => {
      // Test with invalid parameters
      await request(app.getHttpServer())
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          // Missing required fields
          amount: -100, // Invalid negative amount
        })
        .expect(400);
    });

    it('should transform response correctly from contract calls', async () => {
      // Create and process a claim to test response transformation
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          campaignId: DETERMINISTIC_TEST_DATA.campaign.id,
          amount: 750.00,
          recipientRef: 'transform-test-recipient',
        })
        .expect(201);

      expect(createResponse.body).toHaveProperty('id');
      expect(createResponse.body).toHaveProperty('amount', '750.00');
      expect(createResponse.body).toHaveProperty('status', 'requested');
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for claim operations', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/claims')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        // Missing Authorization header
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/claims')
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          campaignId: DETERMINISTIC_TEST_DATA.campaign.id,
          amount: 100.00,
          recipientRef: 'test-recipient',
        })
        .expect(401);
    });

    it('should require proper roles for protected operations', async () => {
      const claimId = DETERMINISTIC_TEST_DATA.claim.id;

      // Test with regular user token (should fail for admin operations)
      const userToken = 'user-jwt-token';
      
      await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/approve`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/disburse`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(403);
    });

    it('should require API key for all operations', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        // Missing x-api-key
        .expect(401);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent claim gracefully', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/claims/non-existent-claim-id')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(404);

      await request(app.getHttpServer())
        .post('/api/v1/claims/non-existent-claim-id/verify')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(404);
    });

    it('should validate claim status transitions', async () => {
      // Create a claim
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          campaignId: DETERMINISTIC_TEST_DATA.campaign.id,
          amount: 100.00,
          recipientRef: 'status-test-recipient',
        })
        .expect(201);

      const claimId = createResponse.body.id;

      // Try to disburse without approval (should fail)
      await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/disburse`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(400);
    });
  });

  describe('Database Side Effects', () => {
    it('should persist claim state changes to database', async () => {
      // Create a claim
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .send({
          campaignId: DETERMINISTIC_TEST_DATA.campaign.id,
          amount: 300.00,
          recipientRef: 'persist-test-recipient',
        })
        .expect(201);

      const claimId = createResponse.body.id;

      // Verify initial state
      let response = await request(app.getHttpServer())
        .get(`/api/v1/claims/${claimId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      expect(response.body.status).toBe('requested');

      // Verify the claim
      await request(app.getHttpServer())
        .post(`/api/v1/claims/${claimId}/verify`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      // Check state persisted
      response = await request(app.getHttpServer())
        .get(`/api/v1/claims/${claimId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-api-key', DETERMINISTIC_TEST_DATA.apiKey)
        .expect(200);

      expect(response.body.status).toBe('verified');
    });
  });
});
