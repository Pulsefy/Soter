import { ScopesGuard } from './scopes.guard';
import { ApiKeyScope } from './api-key-scope.enum';
import { ForbiddenException } from '@nestjs/common';

const mockReflector = { getAllAndOverride: jest.fn() };

const createContext = (user?: Record<string, unknown>) => {
  const req: Record<string, unknown> = { user };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
};

describe('ScopesGuard', () => {
  let guard: ScopesGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ScopesGuard(mockReflector as any);
  });

  it('allows access when no scopes are required', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    const context = createContext({
      scopes: [ApiKeyScope.read],
    });
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('allows access when required scopes is empty array', () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);

    const context = createContext({
      scopes: [ApiKeyScope.read],
    });
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('allows read scope to access read endpoint', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.read]);

    const context = createContext({
      scopes: [ApiKeyScope.read],
    });
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('allows write scope to access read endpoint', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.read]);

    const context = createContext({
      scopes: [ApiKeyScope.write],
    });
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('allows admin scope to access any endpoint', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.admin]);

    const context = createContext({
      scopes: [ApiKeyScope.admin],
    });
    expect(guard.canActivate(context as any)).toBe(true);

    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.read]);
    expect(guard.canActivate(context as any)).toBe(true);

    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.write]);
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('denies read scope from accessing write endpoint', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.write]);

    const context = createContext({
      scopes: [ApiKeyScope.read],
    });
    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });

  it('denies write scope from accessing admin endpoint', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.admin]);

    const context = createContext({
      scopes: [ApiKeyScope.write],
    });
    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });

  it('allows webhook scope to access webhook endpoint', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.webhook]);

    const context = createContext({
      scopes: [ApiKeyScope.webhook],
    });
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('denies non-webhook scope from accessing webhook endpoint', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.webhook]);

    const context = createContext({
      scopes: [ApiKeyScope.read],
    });
    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });

  it('denies access when user has no scopes', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.read]);

    const context = createContext({});
    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });

  it('denies access when user is undefined', () => {
    mockReflector.getAllAndOverride.mockReturnValue([ApiKeyScope.read]);

    const context = createContext();
    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });

  it('allows multiple scopes with sufficient privilege', () => {
    mockReflector.getAllAndOverride.mockReturnValue([
      ApiKeyScope.write,
      ApiKeyScope.read,
    ]);

    const context = createContext({
      scopes: [ApiKeyScope.admin],
    });
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('denies when multiple scopes required and insufficient', () => {
    mockReflector.getAllAndOverride.mockReturnValue([
      ApiKeyScope.admin,
      ApiKeyScope.webhook,
    ]);

    const context = createContext({
      scopes: [ApiKeyScope.read],
    });
    expect(() => guard.canActivate(context as any)).toThrow(ForbiddenException);
  });
});
