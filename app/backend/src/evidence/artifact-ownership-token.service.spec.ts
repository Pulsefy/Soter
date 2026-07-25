import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ArtifactOwnershipTokenService } from './artifact-ownership-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';

describe('ArtifactOwnershipTokenService', () => {
  let service: ArtifactOwnershipTokenService;
  let prismaService: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let configService: jest.Mocked<ConfigService>;

  const mockSigningSecret = 'test-signing-secret-at-least-32-characters-long';
  const mockArtifactId = 'artifact-123';
  const mockOrgId = 'org-456';
  const mockUserId = 'user-789';
  const mockRole = 'operator';

  beforeEach(async () => {
    prismaService = {
      artifactAccessToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      evidenceQueueItem: {
        findUnique: jest.fn().mockResolvedValue({ id: mockArtifactId, orgId: mockOrgId }),
      },
    } as any;

    auditService = {
      record: jest.fn().mockResolvedValue({}),
    } as any;

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ARTIFACT_TOKEN_SIGNING_SECRET') return mockSigningSecret;
        if (key === 'ARTIFACT_TOKEN_TTL_SECONDS') return '300';
        return null;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtifactOwnershipTokenService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AuditService, useValue: auditService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ArtifactOwnershipTokenService>(
      ArtifactOwnershipTokenService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createToken', () => {
    it('should create a valid token with correct payload', async () => {
      const token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
      });

      expect(token).toBeDefined();
      const parts = token.split('.');
      expect(parts).toHaveLength(2);

      // Decode payload
      const payload = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf-8'),
      );

      expect(payload.artifactId).toBe(mockArtifactId);
      expect(payload.orgId).toBe(mockOrgId);
      expect(payload.userId).toBe(mockUserId);
      expect(payload.role).toBe(mockRole);
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });

    it('should store token hash in database', async () => {
      const _token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
      });

      expect(prismaService.artifactAccessToken.create).toHaveBeenCalledWith({
        data: {
          artifactId: mockArtifactId,
          orgId: mockOrgId,
          userId: mockUserId,
          role: mockRole,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should record audit log', async () => {
      await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
      });

      expect(auditService.record).toHaveBeenCalledWith({
        actorId: mockUserId,
        entity: 'artifact_access_token',
        entityId: mockArtifactId,
        action: 'token_created',
        metadata: {
          orgId: mockOrgId,
          role: mockRole,
          expiresAt: expect.any(String),
        },
      });
    });

    it('should use custom TTL when provided', async () => {
      const customTtl = 60;
      const token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
        ttlSeconds: customTtl,
      });

      const payload = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString('utf-8'),
      );

      expect(payload.exp - payload.iat).toBe(customTtl);
    });

    it('should reject TTL > 3600 seconds', async () => {
      await expect(
        service.createToken({
          artifactId: mockArtifactId,
          orgId: mockOrgId,
          userId: mockUserId,
          role: mockRole,
          ttlSeconds: 3601,
        }),
      ).rejects.toThrow('TTL must be between 1 and 3600 seconds');
    });

    it('should reject TTL <= 0', async () => {
      await expect(
        service.createToken({
          artifactId: mockArtifactId,
          orgId: mockOrgId,
          userId: mockUserId,
          role: mockRole,
          ttlSeconds: 0,
        }),
      ).rejects.toThrow('TTL must be between 1 and 3600 seconds');
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', async () => {
      const token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
      });

      prismaService.artifactAccessToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        revokedAt: null,
      } as any);

      const result = await service.verifyToken(token);

      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.artifactId).toBe(mockArtifactId);
      expect(result.payload!.orgId).toBe(mockOrgId);
    });

    it('should reject token with invalid signature', async () => {
      const token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
      });

      // Tamper with token
      const parts = token.split('.');
      const tamperedToken = parts[0] + '.invalidsignature';

      const result = await service.verifyToken(tamperedToken);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid_signature');
    });

    it('should reject expired token', async () => {
      // Create token with very short TTL
      const token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
        ttlSeconds: 1,
      });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await service.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('token_expired');
    });

    it('should reject revoked token', async () => {
      const token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
      });

      // Mock revoked token lookup
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      prismaService.artifactAccessToken.findUnique.mockResolvedValue({
        tokenHash,
        revokedAt: new Date(),
      } as any);

      const result = await service.verifyToken(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('token_revoked');
    });

    it('should reject malformed token', async () => {
      const result = await service.verifyToken('not-a-valid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid_token_format');
    });

    it('should reject token with wrong number of parts', async () => {
      const result = await service.verifyToken('onepart');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('invalid_token_format');
    });
  });

  describe('revokeToken', () => {
    it('should revoke a valid token', async () => {
      const token = await service.createToken({
        artifactId: mockArtifactId,
        orgId: mockOrgId,
        userId: mockUserId,
        role: mockRole,
      });

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      prismaService.artifactAccessToken.findUnique.mockResolvedValue({
        tokenHash,
        artifactId: mockArtifactId,
        userId: mockUserId,
        revokedAt: null,
      } as any);

      await service.revokeToken(tokenHash, 'admin-user', 'security_concern');

      expect(prismaService.artifactAccessToken.update).toHaveBeenCalledWith({
        where: { tokenHash },
        data: {
          revokedAt: expect.any(Date),
          revokedReason: 'security_concern',
        },
      });

      expect(auditService.record).toHaveBeenCalledWith({
        actorId: 'admin-user',
        entity: 'artifact_access_token',
        entityId: mockArtifactId,
        action: 'token_revoked',
        metadata: { reason: 'security_concern', originalUserId: mockUserId },
      });
    });

    it('should throw if token not found', async () => {
      prismaService.artifactAccessToken.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeToken('nonexistent-hash', 'admin-user'),
      ).rejects.toThrow('Token not found');
    });

    it('should throw if token already revoked', async () => {
      prismaService.artifactAccessToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        revokedAt: new Date(),
      } as any);

      await expect(
        service.revokeToken('hash', 'admin-user'),
      ).rejects.toThrow('Token already revoked');
    });
  });

  describe('validateArtifactOwnership', () => {
    it('should return true if artifact belongs to org', async () => {
      const result = await service.validateArtifactOwnership(
        mockArtifactId,
        mockOrgId,
      );

      expect(result).toBe(true);
    });

    it('should return true if artifact has no org (legacy)', async () => {
      prismaService.evidenceQueueItem.findUnique.mockResolvedValue({
        id: mockArtifactId,
        orgId: null,
      } as any);

      const result = await service.validateArtifactOwnership(
        mockArtifactId,
        mockOrgId,
      );

      expect(result).toBe(true);
    });

    it('should return false if artifact belongs to different org', async () => {
      prismaService.evidenceQueueItem.findUnique.mockResolvedValue({
        id: mockArtifactId,
        orgId: 'different-org',
      } as any);

      const result = await service.validateArtifactOwnership(
        mockArtifactId,
        mockOrgId,
      );

      expect(result).toBe(false);
    });

    it('should throw if artifact not found', async () => {
      prismaService.evidenceQueueItem.findUnique.mockResolvedValue(null);

      await expect(
        service.validateArtifactOwnership('nonexistent', mockOrgId),
      ).rejects.toThrow('Artifact not found');
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should delete expired tokens', async () => {
      prismaService.artifactAccessToken.deleteMany.mockResolvedValue({
        count: 5,
      });

      const count = await service.cleanupExpiredTokens();

      expect(count).toBe(5);
      expect(prismaService.artifactAccessToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
          revokedAt: null,
        },
      });
    });

    it('should not delete revoked tokens', async () => {
      prismaService.artifactAccessToken.deleteMany.mockResolvedValue({
        count: 0,
      });

      await service.cleanupExpiredTokens();

      expect(prismaService.artifactAccessToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
          revokedAt: null,
        },
      });
    });
  });
});