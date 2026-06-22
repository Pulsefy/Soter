import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Response } from 'express';
import { getDeprecationMetadata } from '../decorators/deprecated.decorator';
import { DEPRECATION_POLICY } from '../constants/api-version.constants';

/**
 * DeprecationInterceptor
 *
 * This interceptor checks for deprecation metadata on handlers and controllers.
 * If found, it adds the appropriate RFC-standardized deprecation headers to the response.
 */
@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const handler = context.getHandler();
    const controller = context.getClass();

    // Check for deprecation metadata on handler first, then controller
    const metadata =
      getDeprecationMetadata(handler) || getDeprecationMetadata(controller);

    if (metadata && metadata.deprecated) {
      const response = context.switchToHttp().getResponse<Response>();

      // 1. Deprecation Header
      // RFC Draft: https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-deprecation-header-02
      // Can be a boolean or a date
      const deprecationValue = metadata.deprecatedSince || 'true';
      response.setHeader(
        DEPRECATION_POLICY.DEPRECATION_HEADER,
        deprecationValue,
      );

      // 2. Sunset Header
      // RFC 8594: https://tools.ietf.org/html/rfc8594
      if (metadata.sunsetDate) {
        response.setHeader(
          DEPRECATION_POLICY.SUNSET_HEADER,
          metadata.sunsetDate,
        );
      }

      // 3. Link Header
      // RFC 8288: https://tools.ietf.org/html/rfc8288
      const links: string[] = [];

      if (metadata.alternative) {
        // Link to alternative resource
        links.push(`<${metadata.alternative}>; rel="alternate"`);
      }

      if (metadata.migrationGuide) {
        // Link to migration documentation
        links.push(`<${metadata.migrationGuide}>; rel="deprecation"`);
      }

      if (links.length > 0) {
        response.setHeader(DEPRECATION_POLICY.LINK_HEADER, links.join(', '));
      }
    }

    return next.handle();
  }
}
