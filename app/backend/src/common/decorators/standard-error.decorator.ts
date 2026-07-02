import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

/**
 * Decorator that ensures a controller method returns standardized error responses
 * Also documents the possible error responses in Swagger
 */
export function StandardErrorResponses(...statusCodes: number[]) {
  const decorators: (MethodDecorator | ClassDecorator)[] = [];

  // Add standard error responses
  const defaultErrors = [400, 401, 403, 404, 409, 422, 429, 500];
  const errorCodes = statusCodes.length > 0 ? statusCodes : defaultErrors;

  for (const code of errorCodes) {
    decorators.push(
      ApiResponse({
        status: code,
        description: getErrorDescription(code),
        type: ErrorResponseDto,
      }),
    );
  }

  return applyDecorators(...decorators);
}

/**
 * Get error description for HTTP status code
 */
function getErrorDescription(code: number): string {
  const descriptions: Record<number, string> = {
    400: 'Bad Request - Invalid input parameters',
    401: 'Unauthorized - Authentication required',
    403: 'Forbidden - Insufficient permissions',
    404: 'Not Found - Resource does not exist',
    409: 'Conflict - Resource already exists or state conflict',
    422: 'Unprocessable Entity - Validation failed',
    429: 'Too Many Requests - Rate limit exceeded',
    500: 'Internal Server Error - Unexpected error occurred',
  };
  return descriptions[code] || 'Error occurred';
}

/**
 * Meta key for standard error handling
 */
export const STANDARD_ERROR_KEY = 'standardError';

/**
 * Decorator to mark a controller for standard error handling
 */
export function UseStandardErrorHandling(): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(STANDARD_ERROR_KEY, true));
}
