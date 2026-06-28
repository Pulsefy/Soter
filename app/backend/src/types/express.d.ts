import { AppRole } from '../auth/app-role.enum';

declare global {
  namespace Express {
    interface Request {
      user?: {
        role: AppRole;
        id?: string;
        email?: string;
        sub?: string;
        ngoId?: string | null;
        orgId?: string | null;
        apiKeyId?: string;
        authType?: 'apiKey' | 'envApiKey';
      };
    }
  }
}
