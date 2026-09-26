import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AppRole } from '../../auth/app-role.enum';
import { ApiKeyScope } from '../../api-keys/api-key-scope.enum';
import { createHash } from 'node:crypto';

function parseScopes(raw: string | null | undefined): ApiKeyScope[] {
  if (!raw) return [ApiKeyScope.admin];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [ApiKeyScope.admin];
  } catch {
    return [ApiKeyScope.admin];
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const apiKeyHeader = request.headers['x-api-key'];
    const apiKey =
      typeof apiKeyHeader === 'string'
        ? apiKeyHeader
        : Array.isArray(apiKeyHeader)
          ? apiKeyHeader[0]
          : undefined;

    if (!apiKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');

    // Look up by credential match only; lifecycle state (revocation, expiry,
    // rotation grace window) is evaluated below so each failure mode produces
    // a distinguishable error response.
    const record = await this.prisma.apiKey.findFirst({
      where: {
        OR: [{ keyHash: apiKeyHash }, { key: apiKey }],
      },
    });

    if (record) {
      const now = Date.now();

      if (record.revokedAt && record.revokedAt.getTime() <= now) {
        throw new UnauthorizedException('API key has been revoked');
      }

      if (record.expiresAt && record.expiresAt.getTime() <= now) {
        throw new UnauthorizedException('API key has expired');
      }

      // A rotated-out predecessor stays valid until its grace window ends.
      if (
        record.graceExpiresAt &&
        record.graceExpiresAt.getTime() <= now &&
        record.replacedById
      ) {
        throw new UnauthorizedException(
          'API key has been rotated and its grace period has ended',
        );
      }

      // Record usage for lifecycle visibility (best-effort, but awaited to ensure consistency in tests)
      await this.prisma.apiKey.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      });

      request.user = {
        role: record.role,
        ngoId: record.ngoId,
        apiKeyId: record.id,
        authType: 'apiKey',
        scopes: parseScopes(record.scopes),
      };
      return true;
    }

    // Backward-compatibility fallback: if no DB record exists but the key
    // matches the env-var API_KEY, treat the caller as admin with all scopes.
    const envKey = this.configService.get<string>('API_KEY');
    if (apiKey === envKey) {
      request.user = {
        role: AppRole.admin,
        authType: 'envApiKey',
        scopes: [ApiKeyScope.admin],
      };
      return true;
    }

    throw new UnauthorizedException('Invalid or missing API key');
  }
}
