/**
 * Augments Express.Request with the authenticated user attached by API-key /
 * JWT guards.
 *
 * This file must remain a global script (no top-level import/export) so the
 * merge applies during ts-node's per-file compilation used by spec:check.
 */
declare namespace Express {
  interface Request {
    user?: {
      role: import('../auth/app-role.enum').AppRole;
      id?: string;
      email?: string;
      sub?: string;
      ngoId?: string | null;
      orgId?: string | null;
      apiKeyId?: string;
      authType?: 'apiKey' | 'envApiKey';
      scopes?: import('../api-keys/api-key-scope.enum').ApiKeyScope[];
    };
  }
}
