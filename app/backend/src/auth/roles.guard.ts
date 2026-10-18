import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
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
      return true; // No role required — open to any authenticated caller
    }

    const request = context.switchToHttp().getRequest<Request>();
    const role = request.user?.role;

    if (!role || !requiredRoles.includes(role)) {
      throw new AppException(
        ERROR_CODES.FORBIDDEN,
        403,
        'Access denied: insufficient role',
      );
    }

    return true;
  }
}
