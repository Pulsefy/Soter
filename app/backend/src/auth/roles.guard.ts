import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles) {
      return true; // No role required
    }

    const request = context.switchToHttp().getRequest();

    // Simple header/api-key stub for demo purposes
    const userRole = request.headers['x-role'] as string;
    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException('Access denied: insufficient role');
    }

    return true;
  }
}
