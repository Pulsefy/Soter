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
  delegateAddress?: string;
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
  delegateAddresses?: (string | null)[];
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
  claimerAddress: string; // Either recipient or approved delegate
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
  delegate?: string;
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

export interface UpdateDelegateParams {
  packageId: string;
  operatorAddress: string;
  newDelegateAddress: string | null;
}

export interface UpdateDelegateResult {
  packageId: string;
  transactionHash: string;
  timestamp: Date;
  status: 'success' | 'failed';
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

  /**
   * Update the delegate address for an aid package
   */
  updateDelegate(params: UpdateDelegateParams): Promise<UpdateDelegateResult>;

  // Legacy methods - kept for backward compatibility
  createClaim(params: CreateClaimParams): Promise<CreateClaimResult>;
  disburse(params: DisburseParams): Promise<DisburseResult>;
}
