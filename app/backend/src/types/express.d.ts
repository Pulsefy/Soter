import { AppRole } from '../auth/app-role.enum';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id?: string;
        email?: string;
        sub?: string;
        orgId?: string | null;
        role: AppRole;
        ngoId?: string | null;
        apiKeyId?: string;
        authType?: 'apiKey' | 'envApiKey';
      };
    }
  }
}
