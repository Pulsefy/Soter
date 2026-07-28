import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standardized error response format for all API endpoints
 * Ensures consistent error envelope across the entire application
 */
export class ErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code of the error response',
    example: 400,
  })
  code: number;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Validation failed',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Optional correlation ID for tracing the error',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  traceId?: string;

  @ApiPropertyOptional({
    description: 'ISO timestamp when the error occurred',
    example: '2026-01-15T10:30:00.000Z',
  })
  timestamp?: string;

  @ApiPropertyOptional({
    description: 'Request path that caused the error',
    example: '/api/v1/claims/123',
  })
  path?: string;

  @ApiPropertyOptional({
    description:
      'Additional error details (validation errors, stack traces, etc.)',
    example: { field: 'email', errors: ['must be a valid email'] },
  })
  details?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Error code for programmatic handling',
    example: 'VALIDATION_ERROR',
  })
  errorCode?: string;

  @ApiPropertyOptional({
    description: 'Correlation ID for the request',
    example: 'req_abc123',
  })
  correlationId?: string;
}

/**
 * Standard error codes for programmatic handling
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  FOREIGN_KEY_VIOLATION: 'FOREIGN_KEY_VIOLATION',
  UNIQUE_CONSTRAINT_VIOLATION: 'UNIQUE_CONSTRAINT_VIOLATION',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  VALUE_TOO_LONG: 'VALUE_TOO_LONG',
  INVALID_OPERATION: 'INVALID_OPERATION',
  DEPENDENCY_FAILURE: 'DEPENDENCY_FAILURE',
  TIMEOUT: 'TIMEOUT',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Map HTTP status codes to error codes
 */
export function getErrorCodeFromStatus(status: number): ErrorCode {
  const statusMap: Record<number, ErrorCode> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMIT_EXCEEDED',
    500: 'INTERNAL_SERVER_ERROR',
    503: 'SERVICE_UNAVAILABLE',
  };
  return statusMap[status] || 'INTERNAL_SERVER_ERROR';
}
