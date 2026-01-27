import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  const reflector = new Reflector();

  beforeEach(() => {
    guard = new RolesGuard(reflector);
  });

  it('allows access if no roles required', () => {
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies access if role header missing', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);

    const context = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow('Access denied');
  });

  it('allows access for valid role', () => {
    const context = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-role': 'admin' } }),
      }),
    } as unknown as ExecutionContext;

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);

    expect(guard.canActivate(context)).toBe(true);
  });
});
