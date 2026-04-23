import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AppRole } from '../../auth/app-role.enum';

/**
 * Ensures NGO operators can only access resources belonging to their organization.
 * Admins bypass this check. Attach after ApiKeyGuard + RolesGuard.
 *
 * Reads `ngoId` from:
 *  - request.user.ngoId  (set by ApiKeyGuard from the ApiKey record)
 *  - request.params.ngoId OR request.body.ngoId OR request.query.ngoId
 */
@Injectable()
export class OrgOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Not authenticated');

    // Admins can access any org's data
    if (user.role === AppRole.admin) return true;

    // Non-NGO roles (operator, client) are not org-scoped by this guard
    if (user.role !== AppRole.ngo) return true;

    const resourceNgoId: string | undefined =
      (request.params as Record<string, string>)['ngoId'] ??
      (request.body as Record<string, string>)?.['ngoId'] ??
      (request.query as Record<string, string>)['ngoId'];

    if (!resourceNgoId) return true; // no ngoId on resource — allow (listing is scoped in service)

    if (!user.ngoId || user.ngoId !== resourceNgoId) {
      throw new ForbiddenException(
        'Access denied: resource belongs to a different organization',
      );
    }

    return true;
  }
}
