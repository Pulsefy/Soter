import {
  AppException,
  INTEGRATION_ERROR_CODES,
} from '../../common/constants/integration-error-codes';
import {
  CONTRACT_ERROR_BY_CODE,
  CONTRACT_ERROR_BY_NAME,
} from './contract-error-catalog';

/**
 * Maps Soroban contract errors to standardized backend error responses
 * Aligns with the global error handling strategy
 *
 * Uses the shared CONTRACT_ERROR_CATALOG as the single source of truth
 * for contract error definitions, ensuring consistency between the
 * error mapper and the public API endpoint.
 */
export class SorobanErrorMapper {
  /**
   * Soroban contract error codes from AidEscrow (Rust contract)
   * Derived from the shared CONTRACT_ERROR_CATALOG
   */
  private readonly contractErrors: Record<
    number,
    { code: number; message: string; errorCode: string }
  > = Object.entries(CONTRACT_ERROR_BY_CODE).reduce(
    (map, [code, entry]) => {
      map[Number(code)] = {
        code: entry.httpStatusCode,
        message: entry.meaning,
        errorCode: entry.integrationErrorCode,
      };
      return map;
    },
    {} as Record<number, { code: number; message: string; errorCode: string }>,
  );

  /**
   * Maps a Soroban error to a backend-compatible error with HTTP status code
   */
  mapError(error: any): {
    statusCode: number;
    message: string;
    errorCode: string;
    details?: Record<string, unknown>;
  } {
    // Handle RPC/Network errors
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
      return {
        statusCode: 503,
        message: 'Blockchain network unreachable',
        errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_NETWORK_UNREACHABLE,
        details: {
          error_type: 'network_error',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          original_error: error?.message,
        },
      };
    }

    // Handle JSON-RPC errors (Soroban RPC Server responses)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (error?.response?.data?.error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const jsonRpcError = error.response.data.error;
      return this.mapJsonRpcError(jsonRpcError);
    }

    // Handle Soroban SDK errors with specific error codes
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (error?.errorCode !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const mapping = this.contractErrors[error.errorCode as number];
      if (mapping) {
        return {
          statusCode: mapping.code,
          message: mapping.message,
          errorCode: mapping.errorCode,
          details: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            error_code: error.errorCode,
            error_type: 'contract_error',
          },
        };
      }
    }

    // Handle contract invocation errors
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const message = error?.message as string | undefined;
    if (
      message &&
      (message.includes('NotInitialized') ||
        message.includes('AlreadyInitialized') ||
        message.includes('NotAuthorized') ||
        message.includes('PackageNotFound') ||
        message.includes('PackageExpired') ||
        message.includes('PackageNotActive') ||
        message.includes('PackageNotExpired') ||
        message.includes('InsufficientFunds') ||
        message.includes('InsufficientSurplus') ||
        message.includes('PackageIdExists') ||
        message.includes('InvalidState') ||
        message.includes('MismatchedArrays') ||
        message.includes('ContractPaused') ||
        message.includes('ClaimTooEarly') ||
        message.includes('InvalidAmount') ||
        message.includes('InvalidProof') ||
        message.includes('InvalidToken') ||
        message.includes('TokenTransferFailed') ||
        message.includes('NoPendingTransfer') ||
        message.includes('InvalidPendingAdmin') ||
        message.includes('BatchTooLarge') ||
        message.includes('ClaimCooldownActive'))
    ) {
      return this.mapContractErrorMessage(message);
    }

    // Handle timeout errors
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (error?.code === 'ETIMEDOUT' || message?.includes('timeout')) {
      return {
        statusCode: 504,
        message: 'Blockchain operation timed out',
        errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_TRANSACTION_TIMEOUT,
        details: {
          error_type: 'timeout',
          original_error: message,
        },
      };
    }

    // Handle transaction submission errors
    if (message?.includes('transaction')) {
      return {
        statusCode: 400,
        message: 'Transaction submission failed',
        errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_TRANSACTION_FAILED,
        details: {
          error_type: 'transaction_error',
          original_error: message,
        },
      };
    }

    // Default: Internal server error
    return {
      statusCode: 500,
      message: 'An error occurred while communicating with the blockchain',
      errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR,
      details: {
        error_type: 'unknown_error',
        original_message: message,
      },
    };
  }

  /**
   * Maps JSON-RPC error responses (from Soroban RPC)
   */
  private mapJsonRpcError(jsonRpcError: any): {
    statusCode: number;
    message: string;
    errorCode: string;
    details?: Record<string, unknown>;
  } {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const code = jsonRpcError.code;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const message = (jsonRpcError.message as string) || '';

    if (message.includes('Error(Contract')) {
      return this.mapContractErrorMessage(message);
    }

    // JSON-RPC error codes mapping
    switch (code) {
      case -32600: // Invalid Request
      case -32602: // Invalid params
        return {
          statusCode: 400,
          message: 'Invalid request parameters',
          errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR,
          details: { error_code: code, rpc_message: message },
        };

      case -32601: // Method not found
        return {
          statusCode: 404,
          message: 'RPC method not available',
          errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR,
          details: { error_code: code, rpc_message: message },
        };

      case -32603: // Internal error
        return {
          statusCode: 500,
          message: 'Blockchain RPC internal error',
          errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR,
          details: { error_code: code as number, rpc_message: message },
        };

      default:
        // Check if code is in server error range (-32000 to -32099)
        if (code >= -32099 && code <= -32000) {
          return {
            statusCode: 500,
            message: 'Blockchain RPC server error',
            errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR,
            details: { error_code: code as number, rpc_message: message },
          };
        }
        return {
          statusCode: 500,
          message: 'Blockchain RPC error',
          errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_RPC_ERROR,
          details: { error_code: code as number, rpc_message: message },
        };
    }
  }

  /**
   * Maps contract error messages (as strings) to HTTP status codes
   * Uses the shared CONTRACT_ERROR_CATALOG for consistency
   */
  private mapContractErrorMessage(message: string): {
    statusCode: number;
    message: string;
    errorCode: string;
    details?: Record<string, unknown>;
  } {
    // Try to match by error name from the catalog
    for (const [errorName, entry] of Object.entries(CONTRACT_ERROR_BY_NAME)) {
      if (message.includes(errorName)) {
        return {
          statusCode: entry.httpStatusCode,
          message: entry.meaning,
          errorCode: entry.integrationErrorCode,
          details: {
            error_type: 'contract_error',
            error_name: errorName,
          },
        };
      }
    }

    for (const [errorCode, errorInfo] of Object.entries(this.contractErrors)) {
      if (new RegExp(`#${errorCode}(?!\\d)`).test(message)) {
        return {
          statusCode: errorInfo.code,
          message: errorInfo.message,
          errorCode: errorInfo.errorCode,
          details: {
            error_type: 'contract_error',
            error_code: Number(errorCode),
          },
        };
      }
    }

    // Default mapping
    return {
      statusCode: 500,
      message: 'Contract error occurred',
      errorCode: INTEGRATION_ERROR_CODES.ONCHAIN_CONTRACT_ERROR,
      details: {
        error_type: 'contract_error',
        original_message: message,
      },
    };
  }

  /**
   * Throws an AppException based on the mapped error so AllExceptionsFilter
   * emits the stable onchain errorCode verbatim.
   */
  throwMappedError(error: unknown): never {
    const mapped = this.mapError(error);
    throw new AppException(
      mapped.errorCode,
      mapped.statusCode,
      mapped.message,
      mapped.details,
    );
  }
}
