import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AppRole } from '../../auth/app-role.enum';
import { OrgOwnershipGuard } from './org-ownership.guard';

const makeContext = (user: any, params: any = {}, body: any = {}) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user, params, body, query: {} }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('OrgOwnershipGuard', () => {
  const guard = new OrgOwnershipGuard();

  it('allows admin regardless of ngoId', () => {
    const ctx = makeContext(
      { role: AppRole.admin, ngoId: null },
      { ngoId: 'ngo-other' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ngo when ngoId matches', () => {
    const ctx = makeContext(
      { role: AppRole.ngo, ngoId: 'ngo-1' },
      { ngoId: 'ngo-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies ngo when ngoId does not match', () => {
    const ctx = makeContext(
      { role: AppRole.ngo, ngoId: 'ngo-1' },
      { ngoId: 'ngo-2' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows ngo when no ngoId on resource (listing)', () => {
    const ctx = makeContext({ role: AppRole.ngo, ngoId: 'ngo-1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws when user is not set', () => {
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows operator without ngoId check', () => {
    const ctx = makeContext(
      { role: AppRole.operator, ngoId: null },
      { ngoId: 'ngo-1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
