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

    // Primary path: look up the key in the database
    const record = await this.prisma.apiKey.findUnique({
      where: { key: apiKey },
    });

    if (record) {
      request.user = { role: record.role, apiKeyId: record.id };
      return true;
    }

    // Backward-compatibility fallback: if no DB record exists but the key
    // matches the env-var API_KEY, treat the caller as admin.
    const envKey = this.configService.get<string>('API_KEY');
    if (apiKey === envKey) {
      request.user = { role: AppRole.admin };
      return true;
    }

    throw new UnauthorizedException('Invalid or missing API key');
  }
}
