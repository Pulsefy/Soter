import { ApiKeyGuard } from './api-key.guard';
import { UnauthorizedException } from '@nestjs/common';

const mockReflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
const mockConfigService = { get: jest.fn().mockReturnValue('test-api-key') };

const createContext = (headers: Record<string, string>) => ({
  switchToHttp: () => ({
    getRequest: () => ({ headers }),
  }),
  getHandler: () => ({}),
  getClass: () => ({}),
});

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;

  beforeEach(() => {
    guard = new ApiKeyGuard(
      mockConfigService as any,
      mockReflector as any,
    );
  });

  it('should allow request with valid API key', () => {
    const context = createContext({ 'x-api-key': 'test-api-key' });
    expect(guard.canActivate(context as any)).toBe(true);
  });

  it('should throw UnauthorizedException with missing API key', () => {
    const context = createContext({});
    expect(() => guard.canActivate(context as any)).toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException with invalid API key', () => {
    const context = createContext({ 'x-api-key': 'wrong-key' });
    expect(() => guard.canActivate(context as any)).toThrow(
      UnauthorizedException,
    );
  });

  it('should allow public routes without API key', () => {
    mockReflector.getAllAndOverride.mockReturnValueOnce(true);
    const context = createContext({});
    expect(guard.canActivate(context as any)).toBe(true);
  });
});