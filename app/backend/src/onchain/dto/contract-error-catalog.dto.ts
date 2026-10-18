import { ApiProperty } from '@nestjs/swagger';
import { ContractErrorEntry } from '../utils/contract-error-catalog';

/**
 * Public-facing DTO for contract error catalog entries
 */
export class ContractErrorCatalogDto implements ContractErrorEntry {
  @ApiProperty({
    description: 'Numeric discriminant from the Rust Error enum',
    example: 1,
  })
  code: number;

  @ApiProperty({
    description: 'Error variant name from the Rust Error enum',
    example: 'NotInitialized',
  })
  name: string;

  @ApiProperty({
    description: 'Human-readable description of what the error means',
    example: 'Escrow not initialized',
  })
  meaning: string;

  @ApiProperty({
    description: 'Whether the operation can be retried',
    example: false,
  })
  retryable: boolean;

  @ApiProperty({
    description: 'HTTP status code returned for this error',
    example: 400,
  })
  httpStatusCode: number;

  @ApiProperty({
    description: 'Backend integration error code',
    example: 'ONCHAIN_CONTRACT_ERROR',
  })
  integrationErrorCode: string;
}
