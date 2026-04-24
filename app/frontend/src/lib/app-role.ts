export type AppUserRole =
  | 'admin'
  | 'ngo'
  | 'operator'
  | 'reviewer'
  | 'recipient'
  | 'guest';

export function getAppUserRole(): AppUserRole {
  const role = (process.env.NEXT_PUBLIC_USER_ROLE ?? 'guest').toLowerCase();

  switch (role) {
    case 'admin':
    case 'ngo':
    case 'operator':
    case 'reviewer':
    case 'recipient':
      return role;
    default:
      return 'guest';
  }
}

export function isOperationsRole(role: AppUserRole): boolean {
  return role === 'admin' || role === 'ngo' || role === 'operator' || role === 'reviewer';
}

export function isRecipientRole(role: AppUserRole): boolean {
  return role === 'recipient' || role === 'guest';
}

export function getRoleLabel(role: AppUserRole): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'ngo':
      return 'NGO operator';
    case 'operator':
      return 'Operator';
    case 'reviewer':
      return 'Reviewer';
    case 'recipient':
      return 'Recipient';
    default:
      return 'Guest';
  }
}

export function getRoleAwareHelpCopy(role: AppUserRole): string {
  return isOperationsRole(role)
    ? 'Use mock mode, seed a sample campaign, or create test recipients so reviewers can explore the full workflow without backend data.'
    : 'Use the sample evidence flow and mock data views to understand how requests, verification, and aid tracking work before real records are connected.';
}

export function getSampleVerificationText(role: AppUserRole): string {
  return isOperationsRole(role)
    ? 'Field note: household displaced by flooding, temporary shelter confirmed, food and medicine support requested for four dependants.'
    : 'My family was displaced after flooding and we need support for food, medicine, and temporary shelter while we relocate.';
}
