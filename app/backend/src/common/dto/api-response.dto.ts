import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiResponseDto<T> {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiPropertyOptional({ description: 'Human-readable message' })
  message?: string;

  data?: T;

  @ApiPropertyOptional({ description: 'Error payload (for failed responses)' })
  error?: unknown;

  static ok<T>(data: T, message?: string): ApiResponseDto<T> {
    return { success: true, message, data };
  }

  static fail(message: string, error?: unknown): ApiResponseDto<null> {
    return { success: false, message, error, data: null };
  }
}
