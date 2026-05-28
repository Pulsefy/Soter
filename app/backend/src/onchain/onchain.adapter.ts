export const ONCHAIN_ADAPTER_TOKEN = 'ONCHAIN_ADAPTER';

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
  operatorAddress: string; // Admin or authorized distributor
  packageId: string;
  recipientAddress: string;
  amount: string; // Amount as string to preserve precision (i128)
  tokenAddress: string;
  expiresAt: number; // Unix timestamp
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

// --- View-only result types ---

/**
 * Result for contract metadata view (admin address + version).
 * Safe to expose publicly — contains no privileged data.
 */
export interface GetContractMetadataResult {
  admin: string;
  version: number;
  timestamp: Date;
}

/**
 * Result for global and per-action pause state view.
 * Frontend uses this to conditionally disable UI actions.
 */
export interface GetPauseStateResult {
  paused: boolean;
  createPaused: boolean;
  claimPaused: boolean;
  withdrawPaused: boolean;
  timestamp: Date;
}

/**
 * Result for fee/contract config view.
 * Frontend uses minAmount to validate amounts before submission.
 */
export interface GetFeeConfigResult {
  minAmount: string;
  maxExpiresIn: number;
  allowedTokens: string[];
  timestamp: Date;
}

/**
 * Result for package summary view.
 * Extends AidPackage with derived TTL/expiry fields so the
 * frontend can render claim UI accurately without extra computation.
 *
 * - isExpired: true when expiresAt > 0 && now > expiresAt
 * - ttlSeconds: seconds until expiry, 0 if expired, null if no expiry
 */
export interface GetPackageSummaryResult {
  package: AidPackage;
  isExpired: boolean;
  ttlSeconds: number | null;
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
}

export interface DisburseResult {
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
  amountDisbursed: string;
  metadata?: Record<string, any>;
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

  // --- Read-only view methods ---

  /**
   * Get contract metadata: admin address and current version.
   * Safe to call publicly — exposes no privileged data.
   */
  getContractMetadata(): Promise<GetContractMetadataResult>;

  /**
   * Get global and per-action pause state.
   * Frontend uses these flags to conditionally disable UI actions.
   */
  getPauseState(): Promise<GetPauseStateResult>;

  /**
   * Get contract fee/config: min_amount, max_expires_in, allowed tokens.
   * Frontend validates amounts before submitting transactions.
   */
  getFeeConfig(): Promise<GetFeeConfigResult>;

  /**
   * Get package summary by ID, enriched with derived isExpired and ttlSeconds.
   * Frontend uses this to render the claim UI accurately.
   */
  getPackageSummary(
    params: GetAidPackageParams,
  ): Promise<GetPackageSummaryResult>;

  // Legacy methods - kept for backward compatibility
  createClaim(params: CreateClaimParams): Promise<CreateClaimResult>;
  disburse(params: DisburseParams): Promise<DisburseResult>;
}
