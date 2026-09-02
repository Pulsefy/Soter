import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ERROR_CODES,
  API_ERROR_CODES,
  BASE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  DATABASE_ERROR_CODES,
  AUTH_ERROR_CODES,
  DOMAIN_ERROR_CODES,
  INTEGRATION_ERROR_CODES,
  ApiErrorCode,
  ErrorCode,
  ErrorCodeDescriptor,
  ERROR_CODE_METADATA,
  getErrorCodeFromStatus,
  AppException,
  type IntegrationErrorCode,
} from '../constants/error-codes';

// Re-export error codes, enums, metadata and AppException so consumers can import from DTO or constants
export {
  ERROR_CODES,
  API_ERROR_CODES,
  BASE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  DATABASE_ERROR_CODES,
  AUTH_ERROR_CODES,
  DOMAIN_ERROR_CODES,
  INTEGRATION_ERROR_CODES,
  ApiErrorCode,
  ErrorCode,
  ErrorCodeDescriptor,
  ERROR_CODE_METADATA,
  getErrorCodeFromStatus,
  AppException,
  type IntegrationErrorCode,
};

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
