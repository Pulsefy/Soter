import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SCOPES_KEY } from './scopes.decorator';
import { ApiKeyScope } from './api-key-scope.enum';

const SCOPE_HIERARCHY: Record<ApiKeyScope, number> = {
  [ApiKeyScope.read]: 1,
  [ApiKeyScope.write]: 2,
  [ApiKeyScope.admin]: 3,
  [ApiKeyScope.webhook]: 4,
};

const WEBHOOK_SCOPE = ApiKeyScope.webhook;

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as {
      scopes?: ApiKeyScope[];
      authType?: string;
    } | undefined;

    if (!user) {
      throw new ForbiddenException('Access denied: no authenticated user');
    }

    const grantedScopes: ApiKeyScope[] = user.scopes ?? [];

    if (grantedScopes.length === 0) {
      throw new ForbiddenException('Access denied: no API key scopes');
    }

    const grantedLevels = grantedScopes.map(
      s => SCOPE_HIERARCHY[s] ?? 0,
    );
    const maxGrantedLevel = Math.max(...grantedLevels, 0);

    const hasWebhook = grantedScopes.includes(WEBHOOK_SCOPE);

    for (const required of requiredScopes) {
      const requiredLevel = SCOPE_HIERARCHY[required] ?? 0;

      if (required === WEBHOOK_SCOPE) {
        if (!hasWebhook) {
          throw new ForbiddenException(
            `Access denied: webhook scope required`,
          );
        }
        continue;
      }

      if (maxGrantedLevel < requiredLevel) {
        throw new ForbiddenException(
          `Access denied: insufficient API key scope`,
        );
      }
    }

    return true;
  }
}
