import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

interface BlockchainError {
  code?: string | number;
  message?: string;
  response?: {
    data?: {
      error?: any;
    };
  };
  errorCode?: number;
}

/**
 * Maps Soroban contract errors to standardized backend error responses
 * Aligns with the global error handling strategy
 */
export class SorobanErrorMapper {
  /**
   * Soroban contract error codes from AidEscrow (Rust contract)
   */
  private readonly contractErrors: Record<
    number,
    { code: number; message: string }
  > = {
    1: { code: 400, message: 'Escrow not initialized' },
    2: { code: 409, message: 'Escrow already initialized' },
    3: { code: 403, message: 'Not authorized to perform this action' },
    4: { code: 400, message: 'Invalid amount' },
    5: { code: 404, message: 'Package not found' },
    6: { code: 400, message: 'Package is not active' },
    7: { code: 410, message: 'Package has expired' },
    8: { code: 400, message: 'Package has not expired' },
    9: { code: 400, message: 'Insufficient funds in escrow' },
    10: { code: 409, message: 'Package ID already exists' },
    11: { code: 400, message: 'Invalid state transition' },
    12: {
      code: 400,
      message: 'Recipients and amounts arrays have different lengths',
    },
    13: { code: 400, message: 'Insufficient surplus funds' },
    14: { code: 503, message: 'Contract is paused' },
  };

  /**
   * Maps a Soroban error to a backend-compatible error with HTTP status code
   */
  mapError(error: unknown): {
    statusCode: number;
    message: string;
    details?: unknown;
  } {
    // Cast to BlockchainError for type safety
    const err = error as BlockchainError;

    // Handle RPC/Network errors
    if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
      return {
        statusCode: 503,
        message: 'Blockchain network unreachable',
        details: {
          error_type: 'network_error',
          original_error: err.message,
        },
      };
    }

    // Handle JSON-RPC errors (Soroban RPC Server responses)
    if (err && err.response?.data?.error) {
      const jsonRpcError = err.response.data.error;
      return this.mapJsonRpcError(jsonRpcError);
    }

    // Handle Soroban SDK errors with specific error codes
    if (err && err.errorCode !== undefined) {
      const mapping = this.contractErrors[err.errorCode];
      if (mapping) {
        return {
          statusCode: mapping.code,
          message: mapping.message,
          details: {
            error_code: err.errorCode,
            error_type: 'contract_error',
          },
        };
      }
    }

    // Handle contract invocation errors
    if (
      err &&
      err.message &&
      (err.message.includes('NotInitialized') ||
        err.message.includes('AlreadyInitialized') ||
        err.message.includes('NotAuthorized') ||
        err.message.includes('PackageNotFound') ||
        err.message.includes('PackageExpired'))
    ) {
      return this.mapContractErrorMessage(err.message);
    }

    // Handle timeout errors
    if (err && (err.code === 'ETIMEDOUT' || err.message?.includes('timeout'))) {
      return {
        statusCode: 504,
        message: 'Blockchain operation timed out',
        details: {
          error_type: 'timeout',
          original_error: err.message,
        },
      };
    }

    // Handle transaction submission errors
    if (err && err.message?.includes('transaction')) {
      return {
        statusCode: 400,
        message: 'Transaction submission failed',
        details: {
          error_type: 'transaction_error',
          original_error: err.message,
        },
      };
    }

    // Default: Internal server error
    return {
      statusCode: 500,
      message: 'An error occurred while communicating with the blockchain',
      details: {
        error_type: 'unknown_error',
        original_message:
          err instanceof Error ? err.message : 'Unknown blockchain error',
      },
    };
  }

  /**
   * Maps JSON-RPC error responses (from Soroban RPC)
   */
  private mapJsonRpcError(jsonRpcError: unknown): {
    statusCode: number;
    message: string;
    details?: unknown;
  } {
    const err = jsonRpcError as { code?: number; message?: string };
    const code = err?.code;
    const message = err?.message || '';

    // JSON-RPC error codes mapping
    switch (code) {
      case -32600: // Invalid Request
      case -32602: // Invalid params
        return {
          statusCode: 400,
          message: 'Invalid request parameters',
          details: { error_code: code, rpc_message: message },
        };

      case -32601: // Method not found
        return {
          statusCode: 404,
          message: 'RPC method not available',
          details: { error_code: code, rpc_message: message },
        };

      case -32603: // Internal error
        return {
          statusCode: 500,
          message: 'Blockchain RPC internal error',
          details: { error_code: code, rpc_message: message },
        };

      default:
        // Check if code is in server error range (-32000 to -32099)
        if (code >= -32099 && code <= -32000) {
          return {
            statusCode: 500,
            message: 'Blockchain RPC server error',
            details: { error_code: code, rpc_message: message },
          };
        }
        return {
          statusCode: 500,
          message: 'Blockchain RPC error',
          details: { error_code: code, rpc_message: message },
        };
    }
  }

  /**
   * Maps contract error messages (as strings) to HTTP status codes
   */
  private mapContractErrorMessage(message: string): {
    statusCode: number;
    message: string;
    details?: unknown;
  } {
    const errorMap: Record<string, { code: number; message: string }> = {
      NotInitialized: { code: 400, message: 'Escrow not initialized' },
      AlreadyInitialized: { code: 409, message: 'Escrow already initialized' },
      NotAuthorized: {
        code: 403,
        message: 'Not authorized to perform this action',
      },
      InvalidAmount: { code: 400, message: 'Invalid amount' },
      PackageNotFound: { code: 404, message: 'Package not found' },
      PackageNotActive: { code: 400, message: 'Package is not active' },
      PackageExpired: { code: 410, message: 'Package has expired' },
      PackageNotExpired: { code: 400, message: 'Package has not expired' },
      InsufficientFunds: { code: 400, message: 'Insufficient funds in escrow' },
      PackageIdExists: { code: 409, message: 'Package ID already exists' },
      InvalidState: { code: 400, message: 'Invalid state transition' },
      MismatchedArrays: {
        code: 400,
        message: 'Recipients and amounts arrays have different lengths',
      },
      InsufficientSurplus: { code: 400, message: 'Insufficient surplus funds' },
      ContractPaused: { code: 503, message: 'Contract is paused' },
    };

    for (const [errorKey, errorInfo] of Object.entries(errorMap)) {
      if (message.includes(errorKey)) {
        return {
          statusCode: errorInfo.code,
          message: errorInfo.message,
          details: {
            error_type: 'contract_error',
            error_name: errorKey,
          },
        };
      }
    }

    // Default mapping
    return {
      statusCode: 500,
      message: 'Contract error occurred',
      details: {
        error_type: 'contract_error',
        original_message: message,
      },
    };
  }

  /**
   * Throws an appropriate NestJS exception based on the mapped error
   */
  throwMappedError(error: unknown): never {
    const mapped = this.mapError(error);

    if (mapped.statusCode === 400) {
      throw new BadRequestException({
        code: mapped.statusCode,
        message: mapped.message,
        details: mapped.details,
      });
    }

    if (mapped.statusCode === 403) {
      throw new BadRequestException({
        code: 403,
        message: mapped.message,
        details: mapped.details,
      });
    }

    if (mapped.statusCode === 404) {
      throw new BadRequestException({
        code: 404,
        message: mapped.message,
        details: mapped.details,
      });
    }

    if (mapped.statusCode === 409) {
      throw new BadRequestException({
        code: 409,
        message: mapped.message,
        details: mapped.details,
      });
    }

    if (mapped.statusCode === 410) {
      throw new BadRequestException({
        code: 410,
        message: mapped.message,
        details: mapped.details,
      });
    }

    if (mapped.statusCode === 503) {
      throw new InternalServerErrorException({
        code: 503,
        message: mapped.message,
        details: mapped.details,
      });
    }

    throw new InternalServerErrorException({
      code: mapped.statusCode,
      message: mapped.message,
      details: mapped.details,
    });
  }
}
