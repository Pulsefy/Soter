import { ApiKeyGuard } from './api-key.guard';
import { UnauthorizedException } from '@nestjs/common';
import { AppRole } from '../../auth/app-role.enum';

const mockReflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
const mockConfigService = { get: jest.fn().mockReturnValue('test-api-key') };
const mockPrismaService = {
  apiKey: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const createContext = (headers: Record<string, string>) => {
  const req: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
};

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReflector.getAllAndOverride.mockReturnValue(false);
    mockConfigService.get.mockReturnValue('test-api-key');
    mockPrismaService.apiKey.findFirst.mockResolvedValue(null);
    mockPrismaService.apiKey.update.mockResolvedValue({});

    guard = new ApiKeyGuard(
      mockConfigService as any,
      mockReflector as any,
      mockPrismaService as any,
    );
  });

  it('should allow request with valid API key found in DB and attach role', async () => {
    mockPrismaService.apiKey.findFirst.mockResolvedValue({
      id: '1',
      key: 'test-api-key',
      role: AppRole.admin,
    });

    const context = createContext({ 'x-api-key': 'test-api-key' });
    const result = await guard.canActivate(context as any);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest() as any;
    expect(req.user).toMatchObject({ role: AppRole.admin, apiKeyId: '1' });
    expect(mockPrismaService.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '1' },
        data: { lastUsedAt: expect.any(Date) },
      }),
    );
  });

  it('should attach correct role from DB record for operator', async () => {
    mockPrismaService.apiKey.findFirst.mockResolvedValue({
      id: '2',
      key: 'operator-key',
      role: AppRole.operator,
    });

    const context = createContext({ 'x-api-key': 'operator-key' });
    await guard.canActivate(context as any);

    const req = context.switchToHttp().getRequest() as any;
    expect(req.user).toMatchObject({ role: AppRole.operator, apiKeyId: '2' });
  });

  it('should fall back to env key and assign admin role when no DB record', async () => {
    mockPrismaService.apiKey.findFirst.mockResolvedValue(null);

    const context = createContext({ 'x-api-key': 'test-api-key' });
    const result = await guard.canActivate(context as any);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest() as any;
    expect(req.user).toEqual({ role: AppRole.admin, authType: 'envApiKey' });
  });

  it('should throw UnauthorizedException with missing API key', async () => {
    const context = createContext({});
    await expect(guard.canActivate(context as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException with invalid API key (no DB record, no env match)', async () => {
    mockPrismaService.apiKey.findFirst.mockResolvedValue(null);
    mockConfigService.get.mockReturnValue('different-env-key');

    const context = createContext({ 'x-api-key': 'wrong-key' });
    await expect(guard.canActivate(context as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should reject revoked keys immediately', async () => {
    // Guard queries with `revokedAt: null`, so a revoked record should not match
    mockPrismaService.apiKey.findFirst.mockResolvedValue(null);

    const context = createContext({ 'x-api-key': 'revoked-key' });
    await expect(guard.canActivate(context as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should allow public routes without API key', async () => {
    mockReflector.getAllAndOverride.mockReturnValueOnce(true);
    const context = createContext({});
    const result = await guard.canActivate(context as any);
    expect(result).toBe(true);
  });
});
