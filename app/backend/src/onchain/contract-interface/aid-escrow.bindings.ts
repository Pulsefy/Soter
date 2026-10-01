/**
 * aid-escrow.bindings.ts
 *
 * AUTO-GENERATED — do NOT edit by hand.
 * Regenerate with: pnpm --filter backend run contract:generate
 *
 * TypeScript bindings derived from the AidEscrow contract interface artifact
 * at src/onchain/contract-interface/aid-escrow.contract.json.
 *
 * These types mirror the on-chain contract's public surface so that the
 * TypeScript layer stays in sync with the Soroban contract.
 */

// ---------------------------------------------------------------------------
// Enum types
// ---------------------------------------------------------------------------

export enum PackageStatus {
  Created = 'Created',
  Claimed = 'Claimed',
  Expired = 'Expired',
  Cancelled = 'Cancelled',
  Refunded = 'Refunded',
}

export enum ClaimStatus {
  Success = 'Success',
  NotFound = 'NotFound',
  NotActive = 'NotActive',
  ClaimTooEarly = 'ClaimTooEarly',
  Expired = 'Expired',
  RequiresProof = 'RequiresProof',
  Unauthorized = 'Unauthorized',
  CampaignPaused = 'CampaignPaused',
  TransferFailed = 'TransferFailed',
  CooldownActive = 'CooldownActive',
}

export enum BatchAdminActionStatus {
  Success = 'Success',
  NotFound = 'NotFound',
  InvalidState = 'InvalidState',
  Expired = 'Expired',
  NotExpired = 'NotExpired',
  CampaignPaused = 'CampaignPaused',
  TransferFailed = 'TransferFailed',
}

export enum ContractError {
  NotInitialized = 'NotInitialized',
  AlreadyInitialized = 'AlreadyInitialized',
  NotAuthorized = 'NotAuthorized',
  InvalidAmount = 'InvalidAmount',
  PackageNotFound = 'PackageNotFound',
  PackageExpired = 'PackageExpired',
  PackageNotActive = 'PackageNotActive',
  InsufficientFunds = 'InsufficientFunds',
  InsufficientSurplus = 'InsufficientSurplus',
  ContractPaused = 'ContractPaused',
  ActionPaused = 'ActionPaused',
  InvalidToken = 'InvalidToken',
  TokenTransferFailed = 'TokenTransferFailed',
  TokenNotAllowed = 'TokenNotAllowed',
  InvalidConfig = 'InvalidConfig',
  CampaignPaused = 'CampaignPaused',
  InvalidPackageId = 'InvalidPackageId',
  DelegateNotSet = 'DelegateNotSet',
  DelegateExpired = 'DelegateExpired',
  PackageAlreadyClaimed = 'PackageAlreadyClaimed',
  ClaimNotStarted = 'ClaimNotStarted',
  MerkleProofRequired = 'MerkleProofRequired',
  InvalidMerkleProof = 'InvalidMerkleProof',
  CooldownActive = 'CooldownActive',
  AdminTransferPending = 'AdminTransferPending',
  AdminTransferNotPending = 'AdminTransferNotPending',
  MaxDistributorsReached = 'MaxDistributorsReached',
  NotADistributor = 'NotADistributor',
  SurplusWithdrawalPending = 'SurplusWithdrawalPending',
  SurplusWithdrawalNotPending = 'SurplusWithdrawalNotPending',
  SurplusWithdrawalTimelockActive = 'SurplusWithdrawalTimelockActive',
}

// ---------------------------------------------------------------------------
// Struct types
// ---------------------------------------------------------------------------

/** An on-chain aid package. */
export interface ContractPackage {
  id: bigint;
  recipient: string;
  amount: bigint;
  token: string;
  status: PackageStatus;
  created_at: bigint;
  expires_at: bigint;
  claim_starts_at: bigint;
  metadata: Record<string, string>;
  evidence_hash: string;
}

/** Contract configuration. */
export interface ContractConfig {
  min_amount: bigint;
  max_expires_in: bigint;
  allowed_tokens: string[];
  claim_cooldown: bigint;
}

/** Aggregate statistics for a single token. */
export interface ContractAggregates {
  total_committed: bigint;
  total_claimed: bigint;
  total_expired_cancelled: bigint;
}

/**
 * A proposed but not-yet-executed surplus withdrawal.
 *
 * Created by `propose_surplus_withdrawal`; removed by either
 * `cancel_surplus_withdrawal` or `execute_surplus_withdrawal`.
 */
export interface PendingWithdrawal {
  /** Destination address for the transfer. */
  to: string;
  /** Token contract address. */
  token: string;
  /** Amount in smallest token units. */
  amount: bigint;
  /**
   * Earliest ledger timestamp at which `execute_surplus_withdrawal` may be
   * called.  Equal to proposal time + SURPLUS_WITHDRAWAL_DELAY_SECS (86400).
   */
  executable_at: bigint;
}

/** Per-package result from a `batch_claim` call. */
export interface BatchClaimResult {
  package_id: bigint;
  status: ClaimStatus;
  /** Amount transferred; zero unless status is Success. */
  amount: bigint;
}

/** Per-package result from `batch_revoke` / `batch_refund`. */
export interface BatchAdminActionResult {
  package_id: bigint;
  status: BatchAdminActionStatus;
  amount: bigint;
}

// ---------------------------------------------------------------------------
// Function parameter types
// ---------------------------------------------------------------------------

export interface ProposeSurplusWithdrawalParams {
  to: string;
  amount: bigint;
  token: string;
}

export interface CreatePackageParams {
  id: bigint;
  recipient: string;
  amount: bigint;
  token: string;
  expires_at: bigint;
  claim_starts_at: bigint;
  metadata: Record<string, string>;
  merkle_root?: string | null;
  campaign_ref?: string | null;
}

export interface BatchCreatePackagesParams {
  ids: bigint[];
  recipients: string[];
  amounts: bigint[];
  token: string;
  expires_at: bigint[];
  claim_starts_at: bigint[];
  metadata: Record<string, string>[];
  merkle_roots: (string | null)[];
  campaign_refs: (string | null)[];
}

export interface FundParams {
  token: string;
  from: string;
  amount: bigint;
}

export interface ClaimWithProofParams {
  id: bigint;
  proof: string[];
}

export interface SetDelegateWithExpiryParams {
  package_id: bigint;
  delegate: string;
  expires_at: bigint;
}

export interface ListDistributorsParams {
  cursor: number;
  limit: number;
}

export interface ListRecipientPackagesParams {
  recipient: string;
  cursor: bigint;
  limit: number;
}

export interface GetDelegateHistoryParams {
  package_id: bigint;
  cursor: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Constants mirrored from the contract
// ---------------------------------------------------------------------------

/** Minimum delay in seconds between proposing and executing a surplus withdrawal. */
export const SURPLUS_WITHDRAWAL_DELAY_SECS = 86_400n;

/** Maximum batch claim size. */
export const MAX_BATCH_CLAIM_SIZE = 25;

/** Maximum batch revoke/refund size. */
export const MAX_BATCH_REVOKE_REFUND_SIZE = 25;

/** Maximum page size for list queries. */
export const MAX_PAGE_SIZE = 50;

/** Default maximum number of distributor addresses. */
export const DEFAULT_MAX_DISTRIBUTORS = 100;

/** Maximum distributor page size. */
export const MAX_DISTRIBUTOR_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Function name constants (avoids magic strings when building invocations)
// ---------------------------------------------------------------------------

export const CONTRACT_FN = {
  INIT: 'init',
  GET_ADMIN: 'get_admin',
  GET_PENDING_ADMIN: 'get_pending_admin',
  TRANSFER_ADMIN: 'transfer_admin',
  ACCEPT_ADMIN: 'accept_admin',
  CANCEL_ADMIN_TRANSFER: 'cancel_admin_transfer',
  GET_VERSION: 'get_version',
  CONTRACT_VERSION: 'contract_version',
  MIGRATE: 'migrate',
  ADD_DISTRIBUTOR: 'add_distributor',
  REMOVE_DISTRIBUTOR: 'remove_distributor',
  GET_DISTRIBUTOR_COUNT: 'get_distributor_count',
  IS_DISTRIBUTOR: 'is_distributor',
  LIST_DISTRIBUTORS: 'list_distributors',
  GET_MAX_DISTRIBUTORS: 'get_max_distributors',
  SET_MAX_DISTRIBUTORS: 'set_max_distributors',
  SET_CONFIG: 'set_config',
  PAUSE: 'pause',
  UNPAUSE: 'unpause',
  PAUSE_ACTION: 'pause_action',
  UNPAUSE_ACTION: 'unpause_action',
  IS_ACTION_PAUSED: 'is_action_paused',
  IS_PAUSED: 'is_paused',
  PAUSE_CAMPAIGN: 'pause_campaign',
  UNPAUSE_CAMPAIGN: 'unpause_campaign',
  IS_CAMPAIGN_PAUSED: 'is_campaign_paused',
  GET_CONFIG: 'get_config',
  FUND: 'fund',
  CREATE_PACKAGE: 'create_package',
  BATCH_CREATE_PACKAGES: 'batch_create_packages',
  CLAIM: 'claim',
  CLAIM_WITH_PROOF: 'claim_with_proof',
  CLAIM_WITH_RELAYER: 'claim_with_relayer',
  BATCH_CLAIM: 'batch_claim',
  DISBURSE: 'disburse',
  REASSIGN_PACKAGE: 'reassign_package',
  BATCH_REVOKE: 'batch_revoke',
  BATCH_REFUND: 'batch_refund',
  REVOKE: 'revoke',
  REFUND: 'refund',
  CANCEL_PACKAGE: 'cancel_package',
  ATTACH_EVIDENCE_HASH: 'attach_evidence_hash',
  EXTEND_EXPIRATION: 'extend_expiration',
  EXTEND_EXPIRY: 'extend_expiry',
  PROPOSE_SURPLUS_WITHDRAWAL: 'propose_surplus_withdrawal',
  CANCEL_SURPLUS_WITHDRAWAL: 'cancel_surplus_withdrawal',
  EXECUTE_SURPLUS_WITHDRAWAL: 'execute_surplus_withdrawal',
  GET_PENDING_WITHDRAWAL: 'get_pending_withdrawal',
  GET_TOTAL_LOCKED: 'get_total_locked',
  GET_TOTAL_CLAIMED: 'get_total_claimed',
  GET_CAMPAIGN_TOKEN_LOCKED: 'get_campaign_token_locked',
  GET_CAMPAIGN_TOKEN_CLAIMED: 'get_campaign_token_claimed',
  GET_PACKAGE: 'get_package',
  VIEW_PACKAGE_STATUS: 'view_package_status',
  GET_EVIDENCE_HASH: 'get_evidence_hash',
  GET_AGGREGATES: 'get_aggregates',
  GET_CAMPAIGN_PACKAGE_COUNT: 'get_campaign_package_count',
  GET_CAMPAIGN_CLAIM_COUNT: 'get_campaign_claim_count',
  GET_RECIPIENT_PACKAGE_COUNT: 'get_recipient_package_count',
  LIST_RECIPIENT_PACKAGES: 'list_recipient_packages',
  SET_DELEGATE: 'set_delegate',
  SET_DELEGATE_WITH_EXPIRY: 'set_delegate_with_expiry',
  REVOKE_DELEGATE: 'revoke_delegate',
  GET_DELEGATE: 'get_delegate',
  GET_DELEGATE_INFO: 'get_delegate_info',
  GET_DELEGATE_HISTORY: 'get_delegate_history',
  ADD_ALLOWED_TOKEN: 'add_allowed_token',
  REMOVE_ALLOWED_TOKEN: 'remove_allowed_token',
  CLEANUP_EXPIRED_DELEGATES: 'cleanup_expired_delegates',
  SWEEP_EXPIRED_DELEGATES: 'sweep_expired_delegates',
  SWEEP_EXPIRED_PACKAGES: 'sweep_expired_packages',
} as const;

export type ContractFunctionName =
  (typeof CONTRACT_FN)[keyof typeof CONTRACT_FN];
