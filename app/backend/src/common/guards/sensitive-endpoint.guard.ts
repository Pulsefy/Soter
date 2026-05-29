import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

/**
 * Metadata key for marking endpoints as sensitive.
 * Sensitive endpoints have additional CORS restrictions regardless of global CORS policy.
 */
export const IS_SENSITIVE_ENDPOINT_KEY = 'isSensitiveEndpoint';

/**
 * Decorator to mark an endpoint as sensitive.
 * Sensitive endpoints are protected with stricter CORS policies.
 */
export const SensitiveEndpoint =
  () => (target: any, key?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(IS_SENSITIVE_ENDPOINT_KEY, true, descriptor.value);
    } else {
      Reflect.defineMetadata(IS_SENSITIVE_ENDPOINT_KEY, true, target);
    }
  };

/**
 * Guard that enforces strict CORS policy for sensitive endpoints.
 *
 * Sensitive endpoints (admin, financial operations, etc.) are only accessible
 * from production domains, never from preview deployments or development origins.
 */
@Injectable()
export class SensitiveEndpointGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isSensitive = this.reflector.getAllAndOverride<boolean>(
      IS_SENSITIVE_ENDPOINT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isSensitive) {
      return true; // Not a sensitive endpoint, allow normal CORS handling
    }

    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    if (!origin) {
      return true; // No origin header (same-origin or direct API calls)
    }

    // Get production-only origins for sensitive endpoints
    const productionOrigins = this.getProductionOrigins();

    if (productionOrigins.length === 0) {
      // No production origins configured - block all cross-origin requests to sensitive endpoints
      throw new ForbiddenException(
        'Sensitive endpoint access requires production domain configuration',
      );
    }

    const normalizedOrigin = this.normalizeOrigin(origin);

    if (!productionOrigins.includes(normalizedOrigin)) {
      throw new ForbiddenException(
        'Sensitive endpoint not accessible from this origin',
      );
    }

    return true;
  }

  private getProductionOrigins(): string[] {
    const productionOrigins = this.configService.get<string>(
      'CORS_PRODUCTION_ORIGINS',
    );

    if (!productionOrigins) {
      return [];
    }

    return productionOrigins
      .split(',')
      .map(origin => this.normalizeOrigin(origin.trim()))
      .filter(origin => origin.length > 0);
  }

  private normalizeOrigin(origin: string): string {
    return origin.replace(/\/$/, '');
  }
}
