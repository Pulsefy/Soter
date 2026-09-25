import type { Prisma } from '@prisma/client';
import type { VerificationResult } from './interfaces/verification-job.interface';

/**
 * Key under which a claim's verification outcome is stored inside
 * `Claim.anchorMetadata`.
 *
 * The column already carries the AI anchor metadata (campaignRef, claimId,
 * packageId) written by the verification pipeline, so the outcome is persisted
 * beside it instead of in a parallel store. `ClaimsService` reads this key to
 * decide whether a claim may transition to `verified`, which makes the claim
 * row - not the queue, and not an in-flight job - the record of what the AI
 * verification concluded.
 */
export const CLAIM_VERIFICATION_KEY = 'verification';

/**
 * Verification outcome persisted against a single claim.
 */
export interface PersistedVerificationResult {
  passed: boolean;
  score: number;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high' | null;
  factors: string[];
  recommendations: string[];
  threshold: number;
  completedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function asRiskLevel(
  value: unknown,
): PersistedVerificationResult['riskLevel'] {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : null;
}

/**
 * Project a verification result onto the shape persisted on the claim.
 *
 * `details` is optional on the job result, so every field is narrowed here
 * rather than at the call sites.
 */
export function toPersistedVerificationResult(
  result: VerificationResult,
  threshold: number,
): Prisma.InputJsonObject {
  const details = result.details;
  return {
    passed: result.score >= threshold,
    score: result.score,
    confidence: result.confidence,
    riskLevel: asRiskLevel(details?.riskLevel),
    factors: asStringArray(details?.factors),
    recommendations: asStringArray(details?.recommendations),
    threshold,
    completedAt: (result.processedAt ?? new Date()).toISOString(),
  };
}

/**
 * Read the verification outcome persisted on a claim.
 *
 * Returns null when the claim has no completed verification record. Narrowing
 * is defensive because the column is untyped JSON that may have been written
 * by an older version of the pipeline.
 */
export function readPersistedVerificationResult(
  anchorMetadata: unknown,
): PersistedVerificationResult | null {
  const metadata = asRecord(anchorMetadata);
  const record = metadata ? asRecord(metadata[CLAIM_VERIFICATION_KEY]) : null;
  if (!record) {
    return null;
  }

  const score = typeof record.score === 'number' ? record.score : null;
  const completedAt =
    typeof record.completedAt === 'string' ? record.completedAt : null;
  if (score === null || completedAt === null) {
    return null;
  }

  return {
    passed: record.passed === true,
    score,
    confidence: typeof record.confidence === 'number' ? record.confidence : 0,
    riskLevel: asRiskLevel(record.riskLevel),
    factors: asStringArray(record.factors),
    recommendations: asStringArray(record.recommendations),
    threshold: typeof record.threshold === 'number' ? record.threshold : 0,
    completedAt,
  };
}

/**
 * Merge the anchor metadata and the verification outcome into the JSON column
 * without dropping whatever the column already held.
 *
 * The verification job payload does not always carry anchor metadata, so the
 * write must not be able to erase either the anchor written by the AI service
 * or a previously stored verification outcome.
 */
export function mergeClaimAnchorMetadata(
  existing: unknown,
  anchor: Prisma.InputJsonObject | null,
  verification: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  return {
    ...(asRecord(existing) ?? {}),
    ...(anchor ?? {}),
    [CLAIM_VERIFICATION_KEY]: verification,
  } as Prisma.InputJsonObject;
}
