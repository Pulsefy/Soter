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

export interface GetCampaignTokenTotalsParams {
  /** Off-chain campaign id, passed to the contract as its `campaign_ref`. */
  campaignRef: string;
  /** Token address (SAC id) the campaign's packages were funded in. */
  tokenAddress: string;
}

export interface CampaignTokenTotals {
  campaignRef: string;
  tokenAddress: string;
  /** Amount the contract still considers locked for the campaign/token. */
  totalLocked: string;
  /** Cumulative amount claimed for the campaign/token. */
  totalClaimed: string;
}

export interface GetCampaignTokenTotalsResult {
  totals: CampaignTokenTotals;
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

/**
 * A surplus withdrawal that has been proposed but not yet executed.
 *
 * Mirrors the contract's `PendingWithdrawal` struct, with the timelock
 * expressed in the same terms the API surface uses everywhere else: the amount
 * is a decimal string in token base units (so it survives JSON round trips)
 * and `executableAt` is a unix timestamp in seconds, matching the ledger
 * timestamp the contract compares against.
 */
export interface PendingWithdrawal {
  /** Destination address the funds would be transferred to. */
  to: string;
  /** Token contract address. */
  token: string;
  /** Amount in the token's smallest unit, as a decimal string. */
  amount: string;
  /**
   * Earliest unix timestamp (seconds) at which `executeSurplusWithdrawal` may
   * be submitted. Equals the proposal time plus the contract's
   * `SURPLUS_WITHDRAWAL_DELAY_SECS`.
   */
  executableAt: number;
}

export interface SurplusWithdrawalParams {
  contractId?: string;
}

export interface ProposeSurplusWithdrawalParams extends SurplusWithdrawalParams {
  /** Destination address for the funds. */
  to: string;
  /** Amount in the token's smallest unit, as a decimal string. */
  amount: string;
  /** Token contract address; must be on the contract's allowlist. */
  token: string;
}

/**
 * Result of one leg of the timelocked surplus withdrawal state machine.
 *
 * `pendingWithdrawal` is read back from the contract after the write so callers
 * record verified state rather than the values they submitted. It is `null`
 * after a cancel or execute, and after a rejected proposal the contract never
 * created one.
 */
export interface SurplusWithdrawalResult {
  contractId: string;
  transactionHash: string;
  pendingWithdrawal: PendingWithdrawal | null;
  timestamp: Date;
}

/** Read-only view of the timelocked surplus withdrawal state. */
export interface SurplusWithdrawalStatus {
  contractId: string;
  pendingWithdrawal: PendingWithdrawal | null;
  /**
   * Seconds remaining before the pending proposal becomes executable. `0` when
   * no proposal is pending, and `0` once the delay has elapsed.
   */
  timelockRemainingSeconds: number;
  timestamp: Date;
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
   * Optional per-campaign, per-token locked/claimed totals.
   *
   * `getAidPackageCount` returns token-wide totals summed across every
   * campaign; this narrower read is the counterpart used to reconcile a single
   * campaign's off-chain `BalanceLedger` against the contract. Implemented by
   * every shipped adapter, optional so external test doubles stay valid.
   */
  getCampaignTokenTotals?(
    params: GetCampaignTokenTotalsParams,
  ): Promise<GetCampaignTokenTotalsResult>;

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
   * Step one of a timelocked surplus withdrawal: record the intent to move
   * `amount` of `token` to `to`, and start the contract's timelock.
   *
   * No funds move. Only one proposal may be pending at a time.
   */
  proposeSurplusWithdrawal(
    params: ProposeSurplusWithdrawalParams,
  ): Promise<SurplusWithdrawalResult>;

  /**
   * Abandon a pending surplus withdrawal proposal. Moves no funds.
   */
  cancelSurplusWithdrawal(
    params?: SurplusWithdrawalParams,
  ): Promise<SurplusWithdrawalResult>;

  /**
   * Step two of a timelocked surplus withdrawal: transfer the proposed funds
   * and clear the proposal.
   *
   * Rejects with a timelock-specific error while the delay has not elapsed, so
   * a premature attempt is distinguishable from any other contract failure.
   */
  executeSurplusWithdrawal(
    params?: SurplusWithdrawalParams,
  ): Promise<SurplusWithdrawalResult>;

  /**
   * Read the pending surplus withdrawal proposal, or `null` when none exists.
   */
  getPendingWithdrawal(
    params?: SurplusWithdrawalParams,
  ): Promise<PendingWithdrawal | null>;

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
