/**
 * Contract Error Catalog
 *
 * Single source of truth for AidEscrow contract error codes.
 * This catalog is kept in sync with the Rust contract's Error enum
 * (app/onchain/contracts/aid_escrow/src/lib.rs) and the stability tests
 * (app/onchain/contracts/aid_escrow/tests/error_codes.rs).
 *
 * When adding new error variants to the contract:
 * 1. Update the Rust Error enum with the next discriminant
 * 2. Add the corresponding entry here with metadata
 * 3. Update the stability test to pin the new code
 * 4. The SorobanErrorMapper will automatically use this catalog
 */

export interface ContractErrorEntry {
  /** Numeric discriminant from the Rust Error enum */
  code: number;
  /** Error variant name from the Rust Error enum */
  name: string;
  /** Human-readable description of what the error means */
  meaning: string;
  /** Whether the operation can be retried (e.g., transient vs permanent failure) */
  retryable: boolean;
  /** HTTP status code to return for this error */
  httpStatusCode: number;
  /** Backend integration error code to use */
  integrationErrorCode: string;
}

/**
 * Complete catalog of AidEscrow contract errors.
 * Must be kept in sync with the Rust Error enum discriminants.
 */
export const CONTRACT_ERROR_CATALOG: readonly ContractErrorEntry[] = [
  {
    code: 1,
    name: 'NotInitialized',
    meaning: 'Escrow not initialized',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 2,
    name: 'AlreadyInitialized',
    meaning: 'Escrow already initialized',
    retryable: false,
    httpStatusCode: 409,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 3,
    name: 'NotAuthorized',
    meaning: 'Not authorized to perform this action',
    retryable: false,
    httpStatusCode: 403,
    integrationErrorCode: 'ONCHAIN_NOT_AUTHORIZED',
  },
  {
    code: 4,
    name: 'InvalidAmount',
    meaning: 'Invalid amount',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 5,
    name: 'PackageNotFound',
    meaning: 'Package not found',
    retryable: false,
    httpStatusCode: 404,
    integrationErrorCode: 'ONCHAIN_PACKAGE_NOT_FOUND',
  },
  {
    code: 6,
    name: 'PackageNotActive',
    meaning: 'Package is not active',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_INVALID_STATE',
  },
  {
    code: 7,
    name: 'PackageExpired',
    meaning: 'Package has expired',
    retryable: false,
    httpStatusCode: 410,
    integrationErrorCode: 'ONCHAIN_PACKAGE_EXPIRED',
  },
  {
    code: 8,
    name: 'PackageNotExpired',
    meaning: 'Package has not expired',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_INVALID_STATE',
  },
  {
    code: 9,
    name: 'InsufficientFunds',
    meaning: 'Insufficient funds in escrow',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_INSUFFICIENT_FUNDS',
  },
  {
    code: 10,
    name: 'PackageIdExists',
    meaning: 'Package ID already exists',
    retryable: false,
    httpStatusCode: 409,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 11,
    name: 'InvalidState',
    meaning: 'Invalid state transition',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_INVALID_STATE',
  },
  {
    code: 12,
    name: 'MismatchedArrays',
    meaning: 'Recipients and amounts arrays have different lengths',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 13,
    name: 'InsufficientSurplus',
    meaning: 'Insufficient surplus funds',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_INSUFFICIENT_FUNDS',
  },
  {
    code: 14,
    name: 'ContractPaused',
    meaning: 'Contract is paused',
    retryable: true,
    httpStatusCode: 503,
    integrationErrorCode: 'ONCHAIN_CONTRACT_PAUSED',
  },
  {
    code: 15,
    name: 'ClaimTooEarly',
    meaning: 'Claim window has not started',
    retryable: true,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_INVALID_STATE',
  },
  {
    code: 16,
    name: 'InvalidProof',
    meaning: 'Invalid claim proof',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 17,
    name: 'InvalidToken',
    meaning: 'Invalid token contract address',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 18,
    name: 'TokenTransferFailed',
    meaning: 'Token transfer failed',
    retryable: true,
    httpStatusCode: 502,
    integrationErrorCode: 'ONCHAIN_TOKEN_TRANSFER_FAILED',
  },
  {
    code: 19,
    name: 'NoPendingTransfer',
    meaning: 'No pending admin transfer in progress',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 20,
    name: 'InvalidPendingAdmin',
    meaning: 'Invalid pending admin address',
    retryable: false,
    httpStatusCode: 403,
    integrationErrorCode: 'ONCHAIN_NOT_AUTHORIZED',
  },
  {
    code: 21,
    name: 'BatchTooLarge',
    meaning: 'Batch operation exceeds the maximum allowed size',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 22,
    name: 'ClaimCooldownActive',
    meaning: 'Claim cooldown is still active',
    retryable: true,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_INVALID_STATE',
  },
  {
    code: 23,
    name: 'DistributorAlreadyExists',
    meaning: 'Distributor address already has privileges',
    retryable: false,
    httpStatusCode: 409,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 24,
    name: 'DistributorNotFound',
    meaning: 'Distributor address does not have privileges',
    retryable: false,
    httpStatusCode: 404,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 25,
    name: 'DistributorSetFull',
    meaning: 'Distributor set is at maximum capacity',
    retryable: false,
    httpStatusCode: 409,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 26,
    name: 'SurplusWithdrawalPending',
    meaning: 'A surplus withdrawal proposal is already pending',
    retryable: false,
    httpStatusCode: 409,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 27,
    name: 'SurplusWithdrawalNotPending',
    meaning: 'No surplus withdrawal proposal is currently pending',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 28,
    name: 'SurplusWithdrawalTimelockActive',
    meaning: 'Surplus withdrawal timelock delay has not elapsed',
    retryable: true,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
  {
    code: 29,
    name: 'InvalidMerkleRoot',
    meaning:
      'Package metadata merkle_root is not a well-formed 32-byte hex string',
    retryable: false,
    httpStatusCode: 400,
    integrationErrorCode: 'ONCHAIN_CONTRACT_ERROR',
  },
] as const;

/**
 * Lookup map for quick access by error code
 */
export const CONTRACT_ERROR_BY_CODE: Record<number, ContractErrorEntry> =
  CONTRACT_ERROR_CATALOG.reduce(
    (map, entry) => {
      map[entry.code] = entry;
      return map;
    },
    {} as Record<number, ContractErrorEntry>,
  );

/**
 * Lookup map for quick access by error name
 */
export const CONTRACT_ERROR_BY_NAME: Record<string, ContractErrorEntry> =
  CONTRACT_ERROR_CATALOG.reduce(
    (map, entry) => {
      map[entry.name] = entry;
      return map;
    },
    {} as Record<string, ContractErrorEntry>,
  );
