/**
 * Entity-link confidence banding configuration (issue #949)
 *
 * `entity-linking` matches imported records to canonical registry entities
 * and scores each match with a confidence value in [0, 1]. Previously every
 * link was auto-applied regardless of score, which meant low-confidence
 * (likely wrong) matches silently corrupted registry data. This threshold
 * splits links into two bands:
 *
 * - score >= AUTO_ACCEPT_THRESHOLD: auto-accepted, applied immediately
 *   (existing behavior, preserved for confident matches).
 * - score <  AUTO_ACCEPT_THRESHOLD: routed to the review queue
 *   (`EntityLinkReviewStatus.pending_review`) instead of being applied,
 *   until a reviewer accepts, rejects, or remaps it.
 */

const parseThreshold = (
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
};

export const ENTITY_LINK_CONFIDENCE_CONFIG = {
  /**
   * Links scoring at or above this value are auto-accepted and applied
   * immediately. Links below it enter the review queue.
   * Default: 0.9
   */
  AUTO_ACCEPT_THRESHOLD: parseThreshold(
    process.env.ENTITY_LINK_AUTO_ACCEPT_THRESHOLD,
    0.9,
  ),
} as const;

export type EntityLinkConfidenceBand = 'auto_accept' | 'needs_review';

/**
 * Bands a confidence score using the configured threshold.
 */
export function getConfidenceBand(
  confidenceScore: number,
  threshold: number = ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD,
): EntityLinkConfidenceBand {
  return confidenceScore >= threshold ? 'auto_accept' : 'needs_review';
}
