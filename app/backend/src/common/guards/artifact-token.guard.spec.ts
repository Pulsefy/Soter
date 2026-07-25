import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ArtifactTokenGuard } from './artifact-token.guard';
import { ArtifactOwnershipTokenService } from '../../evidence/artifact-ownership-token.service';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

describe('ArtifactTokenGuard', () => {
  let guard: ArtifactTokenGuard;
  let reflector: jest.Mocked<Reflector>;
  let tokenService: jest.Mocked<ArtifactOwnershipTokenService>;

  const mockArtifactId = 'artifact-123';
  const mockOrgId = 'org-456';
  const mockUserId = 'user-789';
  const mockRole = 'operator';

  const mockPayload = {
    artifactId: mockArtifactId,
    orgId: mockOrgId,
    userId: mockUserId,
    role: mockRole,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  };

  beforeEach(async () => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as any;

    tokenService = {
      verifyToken: jest.fn().mockResolvedValue({
        valid: true,
        payload: { ...mockPayload },
      }),
      validateArtifactOwnership: jest.fn().mockResolvedValue(true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtifactTokenGuard,
        { provide: Reflector, useValue: reflector },
        { provide: ArtifactOwnershipTokenService, useValue: tokenService },
      ],
    }).compile();

    guard = module.get<ArtifactTokenGuard>(ArtifactTokenGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createContext = (headers: Record<string, string>, query: Record<string, string> = {}) => {
    const req: Record<string, unknown> = { headers, query };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
  };

  describe('guard activation', () => {
    it('should allow access when REQUIRE_ARTIFACT_TOKEN is false', async () => {
      reflector.getAllAndOverride.mockReturnValue(false);

      const context = createContext({ authorization: 'Bearer valid-token' });
      const result = await guard.canActivate(context as any);

      expect(result).toBe(true);
    });

    it('should skip validation when REQUIRE_ARTIFACT_TOKEN is not set', async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);

      const context = createContext({});
      const result = await guard.canActivate(context as any);

      expect(result).toBe(true);
    });
  });

  describe('token extraction', () => {
    it('should extract token from Authorization header', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const context = createContext({ authorization: 'Bearer test-token' });
      await guard.canActivate(context as any);

      expect(tokenService.verifyToken).toHaveBeenCalledWith('test-token');
    });

    it('should extract token from query parameter', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const context = createContext({}, { token: 'query-token' });
      await guard.canActivate(context as any);

      expect(tokenService.verifyToken).toHaveBeenCalledWith('query-token');
    });

    it('should extract token from X-Artifact-Token header', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const context = createContext({ 'x-artifact-token': 'header-token' });
      await guard.canActivate(context as any);

      expect(tokenService.verifyToken).toHaveBeenCalledWith('header-token');
    });

    it('should prioritize Authorization header over query parameter', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const context = createContext(
        { authorization: 'Bearer auth-token' },
        { token: 'query-token' },
      );
      await guard.canActivate(context as any);

      expect(tokenService.verifyToken).toHaveBeenCalledWith('auth-token');
    });

    it('should throw UnauthorizedException when no token is provided', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const context = createContext({});
      await expect(guard.canActivate(context as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('token verification', () => {
    it('should reject invalid token', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      tokenService.verifyToken.mockResolvedValue({
        valid: false,
        error: 'invalid_signature',
      });

      const context = createContext({ authorization: 'Bearer invalid-token' });
      await expect(guard.canActivate(context as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject expired token', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      tokenService.verifyToken.mockResolvedValue({
        valid: false,
        error: 'token_expired',
      });

      const context = createContext({ authorization: 'Bearer expired-token' });
      await expect(guard.canActivate(context as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject revoked token', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      tokenService.verifyToken.mockResolvedValue({
        valid: false,
        error: 'token_revoked',
      });

      const context = createContext({ authorization: 'Bearer revoked-token' });
      await expect(guard.canActivate(context as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('ownership validation', () => {
    it('should reject cross-organization access', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      tokenService.validateArtifactOwnership.mockResolvedValue(false);

      const context = createContext({ authorization: 'Bearer valid-token' });
      await expect(guard.canActivate(context as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow same-organization access', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      tokenService.validateArtifactOwnership.mockResolvedValue(true);

      const context = createContext({ authorization: 'Bearer valid-token' });
      const result = await guard.canActivate(context as any);

      expect(result).toBe(true);
    });
  });

  describe('role validation', () => {
    it.each(['admin', 'operator', 'reviewer'])('should allow %s role', async (role) => {
      reflector.getAllAndOverride.mockReturnValue(true);
      tokenService.verifyToken.mockResolvedValue({
        valid: true,
        payload: { ...mockPayload, role },
      });

      const context = createContext({ authorization: 'Bearer valid-token' });
      const result = await guard.canActivate(context as any);

      expect(result).toBe(true);
    });

    it.each(['client', 'unknown', 'viewer'])('should reject %s role', async (role) => {
      reflector.getAllAndOverride.mockReturnValue(true);
      tokenService.verifyToken.mockResolvedValue({
        valid: true,
        payload: { ...mockPayload, role },
      });

      const context = createContext({ authorization: 'Bearer valid-token' });
      await expect(guard.canActivate(context as any)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('request augmentation', () => {
    it('should attach token payload to request', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const context = createContext({ authorization: 'Bearer valid-token' });
      await guard.canActivate(context as any);

      const req = context.switchToHttp().getRequest();
      expect(req['artifactToken']).toBeDefined();
      expect(req['artifactToken'].artifactId).toBe(mockArtifactId);
      expect(req['artifactToken'].orgId).toBe(mockOrgId);
    });
  });
});