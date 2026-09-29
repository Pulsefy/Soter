export const ONCHAIN_ADAPTER_TOKEN = 'ONCHAIN_ADAPTER';

export type TxStatus = 'pending' | 'succeeded' | 'failed' | 'unknown';

export interface GetTransactionStatusParams {
  hash: string;
}

export interface GetTransactionStatusResult {
  hash: string;
  status: TxStatus;
  timestamp: Date;
  ledger?: number;
  errorMessage?: string;
}

/**
 * On-chain adapter interface for Soroban AidEscrow contract interactions
 */

export interface InitEscrowParams {
  adminAddress: string;
}

export interface InitEscrowResult {
  escrowAddress: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  metadata?: Record<string, any>;
}

export interface CreateAidPackageParams {
  operatorAddress: string;
  packageId: string;
  recipientAddress: string;
  amount: string;
  tokenAddress: string;
  expiresAt: number;
  metadata?: Record<string, string>;
}

export interface CreateAidPackageResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  metadata?: Record<string, any>;
}

export interface BatchCreateAidPackagesParams {
  operatorAddress: string;
  recipientAddresses: string[];
  amounts: string[]; // Array of amounts as strings
  tokenAddress: string;
  expiresIn: number; // Duration in seconds from now
}

export interface BatchCreateAidPackagesResult {
  packageIds: string[];
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  metadata?: Record<string, any>;
}

export interface ClaimAidPackageParams {
  packageId: string;
  recipientAddress: string;
  receiptPointer?: string;
  amount?: string;
}

export interface ClaimAidPackageResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  amountClaimed: string;
  metadata?: Record<string, any>;
}

export interface DisburseAidPackageParams {
  packageId: string;
  operatorAddress: string; // Usually admin
  receiptPointer?: string;
}

export interface DisburseAidPackageResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  amountDisbursed: string;
  metadata?: Record<string, any>;
}

export interface GetAidPackageParams {
  packageId: string;
}

export interface AidPackage {
  id: string;
  recipient: string;
  amount: string;
  token: string;
  status: 'Created' | 'Claimed' | 'Expired' | 'Cancelled' | 'Refunded';
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, string>;
  claimedAmount?: string;
  remainingAmount?: string;
}

export interface GetAidPackageResult {
  package: AidPackage;
  timestamp: Date;
}

export interface GetAidPackageCountParams {
  token: string;
}

export interface AidPackageAggregates {
  totalCommitted: string; // Sum of Created packages
  totalClaimed: string; // Sum of Claimed packages
  totalExpiredCancelled: string; // Sum of Expired/Cancelled/Refunded packages
}

export interface TokenAggregates {
  tokenAddress: string;
  aggregates: AidPackageAggregates;
}

export interface GetAidPackageCountResult {
  aggregates: AidPackageAggregates;
  tokenAggregates?: TokenAggregates[]; // Aggregates grouped by token
  timestamp: Date;
}

export interface GetTokenBalanceParams {
  tokenAddress: string;
  accountAddress: string;
}

export interface GetTokenBalanceResult {
  tokenAddress: string;
  accountAddress: string;
  balance: string;
  timestamp: Date;
}

export interface ContractMetadata {
  version: string;
  name: string;
  timestamp: Date;
}

export interface ContractVersionParams {
  contractId: string;
}

export interface MigrateContractParams extends ContractVersionParams {
  newVersion: number;
}

export interface MigrateContractResult {
  contractId: string;
  transactionHash: string;
  previousVersion: number;
  newVersion: number;
  timestamp: Date;
}

export interface PauseState {
  isPaused: boolean;
  timestamp: Date;
}

export interface FeeConfig {
  feePercentage: string;
  maxFee: string;
  timestamp: Date;
}

export interface PackageSummary {
  packageId: string;
  totalAmount: string;
  claimedAmount: string;
  status: string;
  timestamp: Date;
}

// Legacy interfaces kept for backward compatibility
export interface CreateClaimParams {
  claimId: string;
  recipientAddress: string;
  amount: string;
  tokenAddress: string;
  expiresAt?: number;
}

export interface CreateClaimResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  metadata?: Record<string, any>;
}

export interface DisburseParams {
  claimId: string;
  packageId: string;
  recipientAddress?: string;
  amount?: string;
  tokenAddress: string; // Required for multi-token support
  receiptPointer?: string;
}

export interface DisburseResult {
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  amountDisbursed: string;
  metadata?: Record<string, any>;
}

export interface ExtendAidPackageExpiryParams {
  packageId: string;
  /**
   * New unix timestamp (in seconds) when the package expires.
   * Strictly greater than current package expiration.
   */
  newExpiresAt: number;
  operatorAddress?: string;
}

export interface ExtendAidPackageExpiryResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  oldExpiresAt?: number;
  newExpiresAt: number;
  metadata?: Record<string, any>;
}

export interface AdminState {
  adminAddress: string;
  pendingAdminAddress: string | null;
  timestamp: Date;
}

export interface AdminTransferParams {
  contractId?: string;
}

export interface TransferAdminParams extends AdminTransferParams {
  newAdminAddress: string;
}

/**
 * Result of one leg of a two-step admin transfer.
 *
 * `adminAddress` / `pendingAdminAddress` are read back from the contract after
 * the write lands, so callers can record verified state rather than the values
 * they submitted.
 */
export interface AdminTransferResult {
  contractId: string;
  transactionHash: string;
  adminAddress: string;
  pendingAdminAddress: string | null;
  timestamp: Date;
}

/**
 * Interface for on-chain operations with Soroban AidEscrow contract
 */
export interface OnchainAdapter {
  /**
   * Initialize the escrow contract with an admin address
   */
  initEscrow(params: InitEscrowParams): Promise<InitEscrowResult>;

  /**
   * Create an aid package on-chain
   */
  createAidPackage(
    params: CreateAidPackageParams,
  ): Promise<CreateAidPackageResult>;

  /**
   * Create multiple aid packages in a batch
   */
  batchCreateAidPackages(
    params: BatchCreateAidPackagesParams,
  ): Promise<BatchCreateAidPackagesResult>;

  /**
   * Claim an aid package as recipient
   */
  claimAidPackage(
    params: ClaimAidPackageParams,
  ): Promise<ClaimAidPackageResult>;

  /**
   * Disburse an aid package by admin
   */
  disburseAidPackage(
    params: DisburseAidPackageParams,
  ): Promise<DisburseAidPackageResult>;

  /**
   * Extend the expiration timestamp of an active aid package.
   *
   * Design Decision:
   * Canonical convention chosen: Absolute timestamp (`extend_expiry(id, new_expires_at)`).
   * Rationale:
   * 1. The smart contract explicitly deprecated relative `extend_expiration(id, additional_time)`
   *    in favor of `extend_expiry(id, new_expires_at)`.
   * 2. Absolute timestamps provide idempotency and protect against race conditions or retry-induced
   *    expiration drift if operations are re-submitted.
   */
  extendAidPackageExpiry(
    params: ExtendAidPackageExpiryParams,
  ): Promise<ExtendAidPackageExpiryResult>;

  /**
   * Get details of an aid package
   */
  getAidPackage(params: GetAidPackageParams): Promise<GetAidPackageResult>;

  /**
   * Get aggregate statistics for aid packages
   */
  getAidPackageCount(
    params: GetAidPackageCountParams,
  ): Promise<GetAidPackageCountResult>;

  /**
   * Get token balance for a specific account
   */
  getTokenBalance(
    params: GetTokenBalanceParams,
  ): Promise<GetTokenBalanceResult>;

  getContractMetadata(): Promise<ContractMetadata>;
  getContractVersion(params: ContractVersionParams): Promise<number>;
  migrateContract(
    params: MigrateContractParams,
  ): Promise<MigrateContractResult>;
  getPauseState(): Promise<PauseState>;
  getFeeConfig(): Promise<FeeConfig>;
  getPackageSummary(packageId: string): Promise<PackageSummary>;

  /**
   * Read the current admin and any transfer in progress.
   */
  getAdminState(params?: AdminTransferParams): Promise<AdminState>;

  /**
   * Step one of a two-step admin transfer: nominate `newAdminAddress` as the
   * pending admin. The nomination does not take effect until the nominated
   * address calls `acceptAdmin`.
   */
  transferAdmin(params: TransferAdminParams): Promise<AdminTransferResult>;

  /**
   * Step two of a two-step admin transfer: called by the pending admin to take
   * the admin role, completing the transfer.
   */
  acceptAdmin(params?: AdminTransferParams): Promise<AdminTransferResult>;

  /**
   * Abandon a transfer proposed via `transferAdmin`, leaving the current admin
   * in place.
   */
  cancelAdminTransfer(
    params?: AdminTransferParams,
  ): Promise<AdminTransferResult>;

  /**
   * Get the status of a transaction by hash
   */
  getTransactionStatus(
    params: GetTransactionStatusParams,
  ): Promise<GetTransactionStatusResult>;

  // Legacy methods - kept for backward compatibility
  createClaim(params: CreateClaimParams): Promise<CreateClaimResult>;
  disburse(params: DisburseParams): Promise<DisburseResult>;
}
