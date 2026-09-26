/**
 * Enumerated reasons a claim can be cancelled.
 *
 * `Claim.cancelReason` has always been free text, which makes it impossible to
 * report on *why* claims get cancelled without reading every string. The
 * `cancelReasonCode` column stores one of these values alongside the optional
 * free-text detail so cancellations can be grouped and reported on reliably.
 */
export enum CancelReasonCode {
  /** The claim duplicates another claim for the same package/recipient. */
  duplicate = 'duplicate',
  /** The recipient failed eligibility checks. */
  recipient_ineligible = 'recipient_ineligible',
  /** Evidence submitted with the claim was rejected during verification. */
  evidence_rejected = 'evidence_rejected',
  /** A fraud signal was raised by verification/AI. */
  fraud_flag = 'fraud_flag',
  /** The claim was replaced through an explicit cancel-and-reissue. */
  reissued = 'reissued',
  /** Legacy or otherwise unclassified cancellation. */
  unspecified = 'unspecified',
}
