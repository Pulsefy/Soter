/**
 * Deprecation Decorators
 *
 * These decorators provide a standardized way to mark endpoints and controllers
 * as deprecated, with support for OpenAPI documentation and HTTP headers.
 */

import 'reflect-metadata';
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DEPRECATION_POLICY } from '../constants/api-version.constants';

/**
 * Metadata key for deprecation information
 */
export const DEPRECATION_KEY = 'deprecation';

/**
 * Deprecation metadata interface
 */
export interface DeprecationMetadata {
  /**
   * Whether the endpoint is deprecated
   */
  deprecated: boolean;

  /**
   * Date when the endpoint was deprecated
   */
  deprecatedSince?: string;

  /**
   * Date when the endpoint will be removed (sunset date)
   */
  sunsetDate?: string;

  /**
   * Reason for deprecation
   */
  reason?: string;

  /**
   * Alternative endpoint or migration path
   */
  alternative?: string;

  /**
   * Link to migration documentation
   */
  migrationGuide?: string;
}

/**
 * Mark an endpoint or controller as deprecated
 *
 * @param metadata - Deprecation metadata
 *
 * @example
 * ```typescript
 * @Controller('users')
 * export class UserController {
 *   @Get()
 *   @Deprecated({
 *     deprecatedSince: '2025-06-01',
 *     sunsetDate: '2025-12-01',
 *     reason: 'Use the new GraphQL endpoint instead',
 *     alternative: 'POST /api/v2/users',
 *     migrationGuide: 'https://docs.pulsefy.com/migration/v2',
 *   })
 *   findAll() {
 *     // ...
 *   }
 * }
 * ```
 */
export function Deprecated(metadata: Omit<DeprecationMetadata, 'deprecated'>) {
  const deprecationMetadata: DeprecationMetadata = {
    deprecated: true,
    ...metadata,
  };

  const description = buildDeprecationDescription(deprecationMetadata);

  return applyDecorators(
    SetMetadata(DEPRECATION_KEY, deprecationMetadata),
    ApiOperation({
      deprecated: true,
      description,
    }),
    ApiResponse({
      status: 200,
      description: 'Success (Deprecated)',
      headers: {
        [DEPRECATION_POLICY.DEPRECATION_HEADER]: {
          description: `Deprecation date: ${metadata.deprecatedSince}`,
          schema: { type: 'string' },
        },
        [DEPRECATION_POLICY.SUNSET_HEADER]: {
          description: `Sunset date: ${metadata.sunsetDate}`,
          schema: { type: 'string' },
        },
      },
    }),
  );
}

/**
 * Build deprecation description for OpenAPI documentation
 */
function buildDeprecationDescription(metadata: DeprecationMetadata): string {
  const parts: string[] = ['⚠️ **DEPRECATED**'];

  if (metadata.reason) {
    parts.push(`**Reason:** ${metadata.reason}`);
  }

  if (metadata.deprecatedSince) {
    parts.push(`**Deprecated since:** ${metadata.deprecatedSince}`);
  }

  if (metadata.sunsetDate) {
    parts.push(`**Sunset date:** ${metadata.sunsetDate}`);
  }

  if (metadata.alternative) {
    parts.push(`**Alternative:** ${metadata.alternative}`);
  }

  if (metadata.migrationGuide) {
    parts.push(`**Migration guide:** ${metadata.migrationGuide}`);
  }

  return parts.join('\n\n');
}

/**
 * Get deprecation metadata from a handler or controller
 */
export function getDeprecationMetadata(
  target: object,
  propertyKey?: string | symbol,
): DeprecationMetadata | undefined {
  if (propertyKey) {
    const metadata = Reflect.getMetadata(DEPRECATION_KEY, target, propertyKey);
    return metadata as DeprecationMetadata | undefined;
  }
  const metadata = Reflect.getMetadata(DEPRECATION_KEY, target);
  return metadata as DeprecationMetadata | undefined;
}
