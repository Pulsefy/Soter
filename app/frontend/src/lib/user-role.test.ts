import {
  canManageCampaigns,
  getNavigationItems,
  getUserRoleLabel,
  normalizeUserRole,
} from './user-role';

describe('user role config', () => {
  it('normalizes supported roles', () => {
    expect(normalizeUserRole(' NGO ')).toBe('ngo');
    expect(normalizeUserRole('ADMIN')).toBe('admin');
    expect(normalizeUserRole('operator')).toBe('operator');
  });

  it('falls back to guest for unknown roles', () => {
    expect(normalizeUserRole('donor')).toBe('guest');
    expect(normalizeUserRole(undefined)).toBe('guest');
    expect(normalizeUserRole('')).toBe('guest');
  });

  it('only exposes campaigns navigation to ngo and admin roles', () => {
    expect(getNavigationItems('ngo').map(item => item.href)).toContain('/campaigns');
    expect(getNavigationItems('admin').map(item => item.href)).toContain('/campaigns');
    expect(getNavigationItems('client').map(item => item.href)).not.toContain('/campaigns');
    expect(getNavigationItems('operator').map(item => item.href)).not.toContain('/campaigns');
  });

  it('uses shared campaign access rules', () => {
    expect(canManageCampaigns('ngo')).toBe(true);
    expect(canManageCampaigns('admin')).toBe(true);
    expect(canManageCampaigns('guest')).toBe(false);
    expect(canManageCampaigns('client')).toBe(false);
  });

  it('provides display labels for shell badges', () => {
    expect(getUserRoleLabel('ngo')).toBe('NGO');
    expect(getUserRoleLabel('operator')).toBe('Operator');
  });
});
