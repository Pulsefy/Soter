import { AppRole } from '../auth/app-role.enum';

declare global {
  namespace Express {
    interface Request {
      user?: {
        role: AppRole;
        apiKeyId?: string;
      };
    }
  }
}
