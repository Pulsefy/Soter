/**
 * Typed domain events for the cancel-and-reissue flow.
 *
 * These are emitted via ClaimEventsService and recorded in the AuditLog so
 * every state change is traceable without an external message broker.
 */

export const CLAIM_EVENT = {
  CANCELLED: 'claim.cancelled',
  REISSUED: 'claim.reissued',
} as const;

export type ClaimEventType = (typeof CLAIM_EVENT)[keyof typeof CLAIM_EVENT];

export interface ClaimCancelledEvent {
  type: typeof CLAIM_EVENT.CANCELLED;
  claimId: string;
  campaignId: string;
  operatorId: string;
  reason?: string;
  /** Amount that was unlocked from the campaign budget */
  unlockedAmount: number;
  timestamp: Date;
}

export interface ClaimReissuedEvent {
  type: typeof CLAIM_EVENT.REISSUED;
  /** The newly created replacement claim */
  newClaimId: string;
  /** The original claim that was cancelled */
  originalClaimId: string;
  campaignId: string;
  operatorId: string;
  amount: number;
  reason?: string;
  timestamp: Date;
}

export type ClaimEvent = ClaimCancelledEvent | ClaimReissuedEvent;
