import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { App } from 'supertest/types';
import * as crypto from 'crypto';

describe('Artifact Ownership Tokens (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let signingSecret: string;

  beforeAll(async () => {
    // Set up signing secret for tests
    signingSecret = 'test-signing-secret-at-least-32-characters-long';
    process.env.ARTIFACT_TOKEN_SIGNING_SECRET = signingSecret;
    process.env.ARTIFACT_TOKEN_TTL_SECONDS = '300';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.artifactAccessToken.deleteMany();
    await prisma.evidenceQueueItem.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Token Generation', () => {
    it('POST /evidence/:id/token creates a valid ownership token', async () => {
      // First, upload an evidence item
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;
      const orgId = 'org-123';

      // Generate token
      const tokenRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId })
        .expect(201);

      expect(tokenRes.body.token).toBeDefined();
      expect(tokenRes.body.artifactId).toBe(artifactId);
      expect(tokenRes.body.orgId).toBe(orgId);
      expect(tokenRes.body.expiresAt).toBeDefined();

      // Verify token can be decoded
      const parts = tokenRes.body.token.split('.');
      expect(parts).toHaveLength(2);

      const payload = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf-8'),
      );
      expect(payload.artifactId).toBe(artifactId);
      expect(payload.orgId).toBe(orgId);
    });

    it('POST /evidence/:id/token rejects token generation for non-existent artifact', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/evidence/nonexistent/token')
        .send({ orgId: 'org-123' })
        .expect(401);

      expect(res.body.message).toContain('Artifact not found');
    });

    it('POST /evidence/:id/token rejects token generation for wrong organization', async () => {
      // Upload evidence to org-123
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .set('x-org-id', 'org-123')
        .expect(201);

      const artifactId = uploadRes.body.id;

      // Try to generate token for different org
      const res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId: 'org-999' })
        .expect(401);

      expect(res.body.message).toContain(
        'Artifact does not belong to the specified organization',
      );
    });

    it('POST /evidence/:id/token requires orgId in request body', async () => {
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .expect(400);

      expect(res.body.message).toContain('orgId is required');
    });
  });

  describe('Token Verification', () => {
    it('POST /evidence/:id/access grants access with valid token', async () => {
      // Upload evidence
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;
      const orgId = 'org-123';

      // Generate token
      const tokenRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId })
        .expect(201);

      const token = tokenRes.body.token;

      // Access artifact with token
      const accessRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/access`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(accessRes.body.artifactId).toBe(artifactId);
      expect(accessRes.body.accessedAt).toBeDefined();
    });

    it('POST /evidence/:id/access rejects request without token', async () => {
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/access`)
        .expect(401);

      expect(res.body.message).toContain('Artifact access token required');
    });

    it('POST /evidence/:id/access rejects expired token', async () => {
      // Upload evidence
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;
      const orgId = 'org-123';

      // Generate token with very short TTL
      const tokenRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId, ttlSeconds: 1 })
        .expect(201);

      const token = tokenRes.body.token;

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Try to access with expired token
      const res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/access`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(res.body.message).toContain('Invalid artifact token');
    });

    it('POST /evidence/:id/access rejects tampered token', async () => {
      // Upload evidence
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;
      const orgId = 'org-123';

      // Generate token
      const tokenRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId })
        .expect(201);

      const token = tokenRes.body.token;

      // Tamper with token
      const parts = token.split('.');
      const tamperedToken = parts[0] + '.invalidsignature';

      // Try to access with tampered token
      const res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/access`)
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);

      expect(res.body.message).toContain('Invalid artifact token');
    });

    it('POST /evidence/:id/access rejects cross-organization token', async () => {
      // Upload evidence to org-123
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .set('x-org-id', 'org-123')
        .expect(201);

      const artifactId = uploadRes.body.id;

      // Generate token for org-999 (different org)
      const tokenRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId: 'org-999' })
        .expect(401);

      expect(tokenRes.body.message).toContain(
        'Artifact does not belong to the specified organization',
      );
    });

    it('POST /evidence/:id/access rejects token with mismatched artifact ID', async () => {
      // Upload two artifacts
      const upload1Res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('evidence 1'), 'test1.txt')
        .expect(201);

      const upload2Res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('evidence 2'), 'test2.txt')
        .expect(201);

      const artifact1Id = upload1Res.body.id;
      const artifact2Id = upload2Res.body.id;
      const orgId = 'org-123';

      // Generate token for artifact 1
      const tokenRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact1Id}/token`)
        .send({ orgId })
        .expect(201);

      const token = tokenRes.body.token;

      // Try to access artifact 2 with token for artifact 1
      const res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact2Id}/access`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(res.body.message).toContain('Token artifact ID mismatch');
    });
  });

  describe('Token Revocation', () => {
    it('should reject revoked tokens', async () => {
      // Upload evidence
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;
      const orgId = 'org-123';

      // Generate token
      const tokenRes = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId })
        .expect(201);

      const token = tokenRes.body.token;

      // Verify token works
      await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/access`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Revoke token via direct DB call (simulating admin action)
      const tokenHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
      await prisma.artifactAccessToken.update({
        where: { tokenHash },
        data: {
          revokedAt: new Date(),
          revokedReason: 'security_concern',
        },
      });

      // Try to access with revoked token
      const res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/access`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(res.body.message).toContain('Invalid artifact token');
    });
  });

  describe('Token Cleanup', () => {
    it('should clean up expired tokens', async () => {
      // Upload evidence
      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('test evidence'), 'test.txt')
        .expect(201);

      const artifactId = uploadRes.body.id;
      const orgId = 'org-123';

      // Generate token with very short TTL
      await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifactId}/token`)
        .send({ orgId, ttlSeconds: 1 })
        .expect(201);

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Count expired tokens before cleanup
      const expiredBefore = await prisma.artifactAccessToken.count({
        where: {
          expiresAt: { lt: new Date() },
          revokedAt: null,
        },
      });

      expect(expiredBefore).toBeGreaterThan(0);

      // Call cleanup endpoint (would be a separate admin endpoint in production)
      // For now, we'll test the service method directly
      const artifactTokenService = app.get(
        'ArtifactOwnershipTokenService' as any,
      );
      if (artifactTokenService?.cleanupExpiredTokens) {
        const cleaned = await artifactTokenService.cleanupExpiredTokens();
        expect(cleaned).toBe(expiredBefore);
      }

      // Verify expired tokens are cleaned up
      const expiredAfter = await prisma.artifactAccessToken.count({
        where: {
          expiresAt: { lt: new Date() },
          revokedAt: null,
        },
      });

      expect(expiredAfter).toBe(0);
    });
  });

  describe('Organization Isolation', () => {
    it('should enforce organization boundaries for artifact access', async () => {
      // Upload evidence to org-123
      const upload1Res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('org123 evidence'), 'org123.txt')
        .set('x-org-id', 'org-123')
        .expect(201);

      // Upload evidence to org-456
      const upload2Res = await request(app.getHttpServer())
        .post('/api/v1/evidence/upload')
        .attach('file', Buffer.from('org456 evidence'), 'org456.txt')
        .set('x-org-id', 'org-456')
        .expect(201);

      const artifact1Id = upload1Res.body.id;
      const artifact2Id = upload2Res.body.id;

      // Generate token for org-123 to access artifact 1
      const token1Res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact1Id}/token`)
        .send({ orgId: 'org-123' })
        .expect(201);

      // Generate token for org-456 to access artifact 2
      const token2Res = await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact2Id}/token`)
        .send({ orgId: 'org-456' })
        .expect(201);

      // org-123 should access artifact 1
      await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact1Id}/access`)
        .set('Authorization', `Bearer ${token1Res.body.token}`)
        .expect(200);

      // org-456 should access artifact 2
      await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact2Id}/access`)
        .set('Authorization', `Bearer ${token2Res.body.token}`)
        .expect(200);

      // org-123 should NOT access artifact 2
      await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact2Id}/access`)
        .set('Authorization', `Bearer ${token1Res.body.token}`)
        .expect(401);

      // org-456 should NOT access artifact 1
      await request(app.getHttpServer())
        .post(`/api/v1/evidence/${artifact1Id}/access`)
        .set('Authorization', `Bearer ${token2Res.body.token}`)
        .expect(401);
    });
  });
});