export const USER_ROLES = ['guest', 'client', 'operator', 'ngo', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type NavigationItem = {
  href: string;
  label: string;
  description: string;
  allowedRoles: readonly UserRole[];
};

const DEFAULT_ROLE: UserRole = 'guest';
const ALL_NAVIGATION_ROLES: readonly UserRole[] = USER_ROLES;
const CAMPAIGN_MANAGER_ROLES: readonly UserRole[] = ['ngo', 'admin'];

const ROLE_LABELS: Record<UserRole, string> = {
  guest: 'roles.guest',
  client: 'roles.client',
  operator: 'roles.operator',
  ngo: 'roles.ngo',
  admin: 'roles.admin',
};

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    href: '/',
    label: 'navigation.home',
    description: 'navigation.homeDescription',
    allowedRoles: ALL_NAVIGATION_ROLES,
  },
  {
    href: '/dashboard',
    label: 'navigation.dashboard',
    description: 'navigation.dashboardDescription',
    allowedRoles: ALL_NAVIGATION_ROLES,
  },
  {
    href: '/campaigns',
    label: 'navigation.campaigns',
    description: 'navigation.campaignsDescription',
    allowedRoles: CAMPAIGN_MANAGER_ROLES,
  },
];

export function normalizeUserRole(role?: string | null): UserRole {
  const normalizedRole = role?.trim().toLowerCase();

  if (!normalizedRole) {
    return DEFAULT_ROLE;
  }

  return USER_ROLES.includes(normalizedRole as UserRole)
    ? (normalizedRole as UserRole)
    : DEFAULT_ROLE;
}

export function getUserRole(role = process.env.NEXT_PUBLIC_USER_ROLE): UserRole {
  return normalizeUserRole(role);
}

export function getUserRoleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

export function canManageCampaigns(role: UserRole): boolean {
  return CAMPAIGN_MANAGER_ROLES.includes(role);
}

export function getNavigationItems(role: UserRole): NavigationItem[] {
  return NAVIGATION_ITEMS.filter(item => item.allowedRoles.includes(role));
}
