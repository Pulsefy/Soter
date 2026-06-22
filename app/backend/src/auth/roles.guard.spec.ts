import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { AppRole } from './app-role.enum';

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

  it('denies access when request.user is not set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.admin]);

    const context = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }), // no user property
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow('Access denied');
  });

  it('denies access when user role is not in required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.admin]);

    const context = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: AppRole.client } }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow('Access denied');
  });

  it('allows access when user role matches required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AppRole.admin]);

    const context = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: AppRole.admin } }),
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when user role is one of multiple required roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([AppRole.admin, AppRole.operator]);

    const context = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: AppRole.operator } }),
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});
