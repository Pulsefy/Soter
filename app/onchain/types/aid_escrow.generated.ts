/**
 * Auto-generated TypeScript types from Soroban contract spec
 *
 * Contract: aid_escrow
 * Version: 0.2.0
 *
 * DO NOT EDIT: This file is auto-generated. Changes will be overwritten.
 * To regenerate, run: npm run generate:contract-types
 */

// ============================================================================
// Data Types
// ============================================================================

export enum PackageStatus {
  Created = 0,
  Claimed = 1,
  Expired = 2,
  Cancelled = 3,
  Refunded = 4,
}

export enum ClaimStatus {
  Success = 0,
  NotFound = 1,
  NotActive = 2,
  ClaimTooEarly = 3,
  Expired = 4,
  RequiresProof = 5,
  Unauthorized = 6,
  CampaignPaused = 7,
  TransferFailed = 8,
}

export interface Package {
  id: number | string;
  recipient: string;
  amount: string;
  token: string;
  status: PackageStatus;
  created_at: number | string;
  expires_at: number | string;
  claim_starts_at: number | string;
  metadata: Record<string, unknown>;
}

export interface Config {
  min_amount: string;
  max_expires_in: number | string;
  allowed_tokens: string[];
}

export interface Aggregates {
  total_committed: string;
  total_claimed: string;
  total_expired_cancelled: string;
}

export interface BatchClaimResult {
  package_id: number | string;
  status: ClaimStatus;
  amount: string;
}

// ============================================================================
// Error Codes
// ============================================================================

export enum aid_escrowError {
  NotInitialized = 1,
  AlreadyInitialized = 2,
  NotAuthorized = 3,
  InvalidAmount = 4,
  PackageNotFound = 5,
  PackageNotActive = 6,
  PackageExpired = 7,
  PackageNotExpired = 8,
  InsufficientFunds = 9,
  PackageIdExists = 10,
  InvalidState = 11,
  MismatchedArrays = 12,
  InsufficientSurplus = 13,
  ContractPaused = 14,
  ClaimTooEarly = 15,
  InvalidProof = 16,
  InvalidToken = 17,
  TokenTransferFailed = 18,
  NoPendingTransfer = 19,
  InvalidPendingAdmin = 20,
  BatchTooLarge = 21,
}

export const aid_escrowErrorMessages: Record<aid_escrowError, string> = {
  [aid_escrowError.NotInitialized]: "NotInitialized",
  [aid_escrowError.AlreadyInitialized]: "AlreadyInitialized",
  [aid_escrowError.NotAuthorized]: "NotAuthorized",
  [aid_escrowError.InvalidAmount]: "InvalidAmount",
  [aid_escrowError.PackageNotFound]: "PackageNotFound",
  [aid_escrowError.PackageNotActive]: "PackageNotActive",
  [aid_escrowError.PackageExpired]: "PackageExpired",
  [aid_escrowError.PackageNotExpired]: "PackageNotExpired",
  [aid_escrowError.InsufficientFunds]: "InsufficientFunds",
  [aid_escrowError.PackageIdExists]: "PackageIdExists",
  [aid_escrowError.InvalidState]: "InvalidState",
  [aid_escrowError.MismatchedArrays]: "MismatchedArrays",
  [aid_escrowError.InsufficientSurplus]: "InsufficientSurplus",
  [aid_escrowError.ContractPaused]: "ContractPaused",
  [aid_escrowError.ClaimTooEarly]: "ClaimTooEarly",
  [aid_escrowError.InvalidProof]: "InvalidProof",
  [aid_escrowError.InvalidToken]: "InvalidToken",
  [aid_escrowError.TokenTransferFailed]: "TokenTransferFailed",
  [aid_escrowError.NoPendingTransfer]: "NoPendingTransfer",
  [aid_escrowError.InvalidPendingAdmin]: "InvalidPendingAdmin",
  [aid_escrowError.BatchTooLarge]: "BatchTooLarge",
};
// ============================================================================
// Events
// ============================================================================

export interface EscrowFunded {
  from: string;
  token: string;
  amount: string;
  timestamp: number | string;
}

export interface PackageCreated {
  package_id: number | string;
  recipient: string;
  amount: string;
  actor: string;
  timestamp: number | string;
}

export interface PackageClaimed {
  package_id: number | string;
  recipient: string;
  amount: string;
  actor: string;
  timestamp: number | string;
  receipt_hash: string;
}

export interface PackageClaimedByRelayer {
  package_id: number | string;
  recipient: string;
  relayer: string;
  amount: string;
  timestamp: number | string;
}

export interface PackageDisbursed {
  package_id: number | string;
  recipient: string;
  amount: string;
  actor: string;
  timestamp: number | string;
  receipt_hash: string;
}

export interface PackageRevoked {
  package_id: number | string;
  recipient: string;
  amount: string;
  actor: string;
  timestamp: number | string;
}

export interface PackageRefunded {
  package_id: number | string;
  recipient: string;
  amount: string;
  actor: string;
  timestamp: number | string;
}

export interface BatchCreatedEvent {
  ids: number | string[];
  admin: string;
  total_amount: string;
}

export interface ExtendedEvent {
  package_id: number | string;
  admin: string;
  old_expires_at: number | string;
  new_expires_at: number | string;
}

export interface SurplusWithdrawnEvent {
  to: string;
  token: string;
  amount: string;
}

export interface ContractPausedEvent {
  admin: string;
}

export interface ContractUnpausedEvent {
  admin: string;
}

export interface ActionPausedEvent {
  admin: string;
  action: string;
}

export interface ActionUnpausedEvent {
  admin: string;
  action: string;
}

export interface CampaignPausedEvent {
  admin: string;
  campaign_ref: string;
}

export interface CampaignUnpausedEvent {
  admin: string;
  campaign_ref: string;
}

export interface DelegateAdded {
  package_id: number | string;
  recipient: string;
  delegate: string;
  actor: string;
  expires_at: number | string;
  timestamp: number | string;
}

export interface DelegateRevoked {
  package_id: number | string;
  recipient: string;
  delegate: string;
  actor: string;
  timestamp: number | string;
}

export interface DelegateClaimed {
  package_id: number | string;
  recipient: string;
  delegate: string;
  amount: string;
  actor: string;
  timestamp: number | string;
}

export interface AdminTransferInitiated {
  admin: string;
  pending_admin: string;
  timestamp: number | string;
}

export interface AdminTransferAccepted {
  admin: string;
  timestamp: number | string;
}

export interface AdminTransferCancelled {
  admin: string;
  timestamp: number | string;
}

export interface TokenAdded {
  admin: string;
  token: string;
  timestamp: number | string;
}

export interface TokenRemoved {
  admin: string;
  token: string;
  timestamp: number | string;
}

// ============================================================================
// Contract Metadata
// ============================================================================

export const CONTRACT_NAME = "aid_escrow";
export const CONTRACT_VERSION = "0.2.0";
