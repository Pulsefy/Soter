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
 *
 * Per-campaign override (issue #949 follow-up):
 * Campaigns may carry an optional confidence threshold override (e.g. a
 * food-distribution campaign vs a cash-transfer campaign may warrant
 * different risk tolerances). When a campaign supplies an override it
 * takes precedence for claims judged against that campaign; otherwise the
 * global default is used unchanged.
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

/**
 * Campaign metadata key under which an optional per-campaign
 * confidence threshold override is stored.
 */
export const CAMPAIGN_CONFIDENCE_THRESHOLD_KEY =
  'confidenceThreshold' as const;

/**
 * Returns true when `value` is a valid confidence threshold in [0, 1].
 */
export function isValidConfidenceThreshold(
  value: unknown,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/**
 * Extracts a campaign's optional confidence threshold override from its
 * metadata blob. Returns `undefined` when no valid override is present,
 * allowing callers to fall back to the global default unchanged.
 */
export function getCampaignConfidenceThreshold(
  metadata: Record<string, unknown> | null | undefined,
): number | undefined {
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const value = metadata[CAMPAIGN_CONFIDENCE_THRESHOLD_KEY];
  return isValidConfidenceThreshold(value) ? value : undefined;
}

/**
 * Resolves the effective confidence threshold for a claim, preferring a
 * campaign-level override when one is supplied and falling back to the
 * global default otherwise.
 */
export function resolveConfidenceThreshold(
  campaignOverride?: number | null,
): number {
  if (isValidConfidenceThreshold(campaignOverride)) {
    return campaignOverride as number;
  }
  return ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD;
}

/**
 * Resolves the effective confidence threshold for a claim using campaign
 * metadata, preferring a valid campaign-level override when present and
 * falling back to the global default unchanged otherwise.
 */
export function resolveConfidenceThresholdFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): number {
  return resolveConfidenceThreshold(getCampaignConfidenceThreshold(metadata));
}
