import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiResponseDto<T> {
  @ApiProperty({
    description: 'Indicates if the request was successful.',
    example: true,
  })
  success!: boolean;

  @ApiPropertyOptional({
    description: 'Human-readable message explaining the result.',
    example: 'Request processed successfully.',
  })
  message?: string;

  @ApiPropertyOptional({
    description: 'The response payload data.',
  })
  data?: T;

  @ApiPropertyOptional({
    description: 'Detailed error information for failed requests.',
    example: { code: 'VALIDATION_ERROR', details: 'Validation failed' },
  })
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };

  @ApiPropertyOptional({
    description: 'Correlation ID for tracking the request',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  correlationId?: string;

  @ApiPropertyOptional({
    description: 'ISO timestamp of the response',
    example: '2026-01-15T10:30:00.000Z',
  })
  timestamp?: string;

  static ok<T>(
    data: T,
    message?: string,
    correlationId?: string,
  ): ApiResponseDto<T> {
    return {
      success: true,
      message,
      data,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static fail(
    message: string,
    errorCode: string = 'INTERNAL_SERVER_ERROR',
    details?: Record<string, any>,
    correlationId?: string,
  ): ApiResponseDto<null> {
    return {
      success: false,
      message,
      error: {
        code: errorCode,
        message,
        details,
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static validationFail(
    errors: Record<string, string[]>,
    correlationId?: string,
  ): ApiResponseDto<null> {
    return {
      success: false,
      message: 'Validation failed',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { errors },
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static notFound(
    entity: string,
    correlationId?: string,
  ): ApiResponseDto<null> {
    return {
      success: false,
      message: `${entity} not found`,
      error: {
        code: 'NOT_FOUND',
        message: `${entity} not found`,
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static unauthorized(
    message?: string,
    correlationId?: string,
  ): ApiResponseDto<null> {
    return {
      success: false,
      message: message || 'Unauthorized',
      error: {
        code: 'UNAUTHORIZED',
        message: message || 'Unauthorized',
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static forbidden(
    message?: string,
    correlationId?: string,
  ): ApiResponseDto<null> {
    return {
      success: false,
      message: message || 'Forbidden',
      error: {
        code: 'FORBIDDEN',
        message: message || 'Forbidden',
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static conflict(
    message: string,
    details?: Record<string, any>,
    correlationId?: string,
  ): ApiResponseDto<null> {
    return {
      success: false,
      message,
      error: {
        code: 'CONFLICT',
        message,
        details,
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static badRequest(
    message: string,
    details?: Record<string, any>,
    correlationId?: string,
  ): ApiResponseDto<null> {
    return {
      success: false,
      message,
      error: {
        code: 'BAD_REQUEST',
        message,
        details,
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }

  static rateLimitExceeded(correlationId?: string): ApiResponseDto<null> {
    return {
      success: false,
      message: 'Too many requests, please try again later.',
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later.',
      },
      data: null,
      correlationId,
      timestamp: new Date().toISOString(),
    };
  }
}
