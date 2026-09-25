/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 *
 * Type definitions for the aid_escrow Soroban contract, generated from the
 * committed contract interface spec.
 *
 * Source: app/onchain/contracts/aid_escrow/interface.xdr
 * Regenerate: pnpm --filter backend run contract:generate
 */

/**
 * Struct: DelegateHistory
 */
export interface DelegateHistory {
  changed_at: bigint;
  changed_by: string;
  new_delegate: string;
  package_id: bigint;
  previous_delegate: string | null;
  reason: string;
}

/**
 * Enum: PackageStatus
 */
export enum PackageStatus {
  /**
   * Enum Case: Created
   */
  Created = 0,
  /**
   * Enum Case: Claimed
   */
  Claimed = 1,
  /**
   * Enum Case: Expired
   */
  Expired = 2,
  /**
   * Enum Case: Cancelled
   */
  Cancelled = 3,
  /**
   * Enum Case: Refunded
   */
  Refunded = 4,
}

/**
 * Struct: Package
 */
export interface Package {
  amount: bigint;
  claim_starts_at: bigint;
  created_at: bigint;
  evidence_hash: string;
  expires_at: bigint;
  id: bigint;
  metadata: Map<string, string>;
  recipient: string;
  status: PackageStatus;
  token: string;
}

/**
 * Struct: Config
 */
export interface Config {
  allowed_tokens: Array<string>;
  /**
   * Minimum number of seconds a recipient must wait between successful
   * claims. `0` disables the cooldown.
   */
  claim_cooldown: bigint;
  max_expires_in: bigint;
  min_amount: bigint;
}

/**
 * Struct: Aggregates
 */
export interface Aggregates {
  total_claimed: bigint;
  total_committed: bigint;
  total_expired_cancelled: bigint;
}

/**
 * Outcome of a single package claim attempt made as part of a `batch_claim`
 * call. `batch_claim` never fails a whole batch because one package could
 * not be claimed; instead each id resolves to one of these statuses.
 */
export enum ClaimStatus {
  /**
   * Package was claimed and the payout was transferred.
   */
  Success = 0,
  /**
   * No package exists with the given id.
   */
  NotFound = 1,
  /**
   * Package status is not `Created` (already claimed, cancelled, or refunded).
   */
  NotActive = 2,
  /**
   * Current ledger time is before the package's `claim_starts_at`.
   */
  ClaimTooEarly = 3,
  /**
   * Package has passed its `expires_at` timestamp.
   */
  Expired = 4,
  /**
   * Package is guarded by a Merkle allowlist; use `claim_with_proof` instead.
   */
  RequiresProof = 5,
  /**
   * Caller is neither the package's recipient nor an authorised delegate.
   */
  Unauthorized = 6,
  /**
   * The package's campaign is paused.
   */
  CampaignPaused = 7,
  /**
   * Eligibility checks passed but the token transfer failed.
   */
  TransferFailed = 8,
  /**
   * The recipient successfully claimed another package too recently.
   */
  CooldownActive = 9,
}

/**
 * Per-package result returned by `batch_claim`.
 */
export interface BatchClaimResult {
  /**
   * Amount transferred to the claimant; zero unless `status` is `Success`.
   */
  amount: bigint;
  package_id: bigint;
  status: ClaimStatus;
}

/**
 * Outcome of one package revoke or refund attempt in a batch.
 */
export enum BatchAdminActionStatus {
  /**
   * Enum Case: Success
   */
  Success = 0,
  /**
   * Enum Case: NotFound
   */
  NotFound = 1,
  /**
   * Enum Case: InvalidState
   */
  InvalidState = 2,
  /**
   * Enum Case: Expired
   */
  Expired = 3,
  /**
   * Enum Case: NotExpired
   */
  NotExpired = 4,
  /**
   * Enum Case: CampaignPaused
   */
  CampaignPaused = 5,
  /**
   * Enum Case: TransferFailed
   */
  TransferFailed = 6,
}

/**
 * Struct: BatchAdminActionResult
 */
export interface BatchAdminActionResult {
  amount: bigint;
  package_id: bigint;
  status: BatchAdminActionStatus;
}

/**
 * Error Enum: Error
 */
export const Error = {
  1: { message: 'NotInitialized' },
  2: { message: 'AlreadyInitialized' },
  3: { message: 'NotAuthorized' },
  4: { message: 'InvalidAmount' },
  5: { message: 'PackageNotFound' },
  6: { message: 'PackageNotActive' },
  7: { message: 'PackageExpired' },
  8: { message: 'PackageNotExpired' },
  9: { message: 'InsufficientFunds' },
  10: { message: 'PackageIdExists' },
  11: { message: 'InvalidState' },
  12: { message: 'MismatchedArrays' },
  13: { message: 'InsufficientSurplus' },
  14: { message: 'ContractPaused' },
  15: { message: 'ClaimTooEarly' },
  16: { message: 'InvalidProof' },
  17: { message: 'InvalidToken' },
  18: { message: 'TokenTransferFailed' },
  19: { message: 'NoPendingTransfer' },
  20: { message: 'InvalidPendingAdmin' },
  21: { message: 'BatchTooLarge' },
  /**
   * The recipient has not yet completed the configured claim cooldown.
   */
  22: { message: 'ClaimCooldownActive' },
  /**
   * `add_distributor` was called for an address that already holds
   * distributor privileges.
   */
  23: { message: 'DistributorAlreadyExists' },
  /**
   * `remove_distributor` was called for an address that does not
   * currently hold distributor privileges.
   */
  24: { message: 'DistributorNotFound' },
  /**
   * `add_distributor` would exceed the configured maximum distributor
   * set size (see `get_max_distributors` / `set_max_distributors`).
   */
  25: { message: 'DistributorSetFull' },
};
