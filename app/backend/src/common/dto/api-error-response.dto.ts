import { ApiProperty } from '@nestjs/swagger';

/**
 * Error response DTO for 422 Unprocessable Entity (validation errors)
 * Used for documenting validation failure examples in OpenAPI
 */
export class ApiValidationErrorResponseDto {
  @ApiProperty({
    description: 'Indicates the request failed.',
    example: false,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Error message describing what went wrong.',
    example: 'Validation failed',
  })
  message!: string;

  @ApiProperty({
    description: 'Validation error details',
    example: {
      errors: [
        {
          field: 'amount',
          message: 'amount must be a number conforming to the specified constraints',
          constraint: 'isNumber',
        },
        {
          field: 'tokenAddress',
          message:
            'tokenAddress must be a valid Stellar address (G... or C... format)',
          constraint: 'matches',
        },
      ],
    },
  })
  error!: Record<string, unknown>;

  @ApiProperty({
    description: 'Response data (null for errors)',
    example: null,
  })
  data: null = null;
}
