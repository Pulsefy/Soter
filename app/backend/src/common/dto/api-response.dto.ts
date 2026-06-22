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
    example: { code: 'VAL_ERR_001', details: 'Validation failed' },
  })
  error?: unknown;

  static ok<T>(data: T, message?: string): ApiResponseDto<T> {
    return { success: true, message, data };
  }

  static fail(message: string, error?: unknown): ApiResponseDto<null> {
    return { success: false, message, error, data: null };
  }
}
