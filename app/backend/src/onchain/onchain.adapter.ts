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

// --- Delegate lifecycle ---

export interface SetDelegateParams {
  /** Package ID to assign a delegate for. */
  packageId: string;
  /** Stellar address of the delegate. */
  delegateAddress: string;
  /** Admin address authorising the change. */
  adminAddress: string;
  /**
   * Optional unix timestamp (seconds) when the delegate authorization expires.
   * `0` or omitted means no expiry.
   */
  expiresAt?: number;
}

export interface SetDelegateResult {
  packageId: string;
  delegateAddress: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  expiresAt?: number;
  metadata?: Record<string, any>;
}

export interface RevokeDelegateParams {
  /** Package ID whose delegate should be removed. */
  packageId: string;
  /** Admin address authorising the revocation. */
  adminAddress: string;
}

export interface RevokeDelegateResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  metadata?: Record<string, any>;
}

export interface GetDelegateParams {
  packageId: string;
}

export interface GetDelegateResult {
  packageId: string;
  /** Current active delegate address, or `null` if none (or expired). */
  delegateAddress: string | null;
  /** Unix timestamp when the delegate authorization expires, or `null` if no expiry. */
  expiresAt: number | null;
  timestamp: Date;
}

export interface DelegateHistoryEntry {
  packageId: string;
  previousDelegate: string | null;
  newDelegate: string;
  changedBy: string;
  changedAt: number;
  reason: string;
}

export interface GetDelegateHistoryParams {
  packageId: string;
}

export interface GetDelegateHistoryResult {
  packageId: string;
  history: DelegateHistoryEntry[];
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
  getPauseState(): Promise<PauseState>;
  getFeeConfig(): Promise<FeeConfig>;
  getPackageSummary(packageId: string): Promise<PackageSummary>;

  /**
   * Get the status of a transaction by hash
   */
  getTransactionStatus(
    params: GetTransactionStatusParams,
  ): Promise<GetTransactionStatusResult>;

  // --- Delegate lifecycle ---

  /**
   * Assign or update a delegate for a package.
   * Pass `expiresAt` to use `set_delegate_with_expiry`; omit it for `set_delegate`.
   */
  setDelegate(params: SetDelegateParams): Promise<SetDelegateResult>;

  /**
   * Remove the delegate for a package.
   */
  revokeDelegate(params: RevokeDelegateParams): Promise<RevokeDelegateResult>;

  /**
   * Return the current active delegate (and expiry) for a package.
   */
  getDelegate(params: GetDelegateParams): Promise<GetDelegateResult>;

  /**
   * Return the full audit history of delegate changes for a package.
   */
  getDelegateHistory(
    params: GetDelegateHistoryParams,
  ): Promise<GetDelegateHistoryResult>;

  // Legacy methods - kept for backward compatibility
  createClaim(params: CreateClaimParams): Promise<CreateClaimResult>;
  disburse(params: DisburseParams): Promise<DisburseResult>;
}
