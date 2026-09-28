import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * The audit entity/action pair `VerificationService.processVerification()`
 * writes after it scores a claim. This is the durable verification record: the
 * claim row only carries the resulting status, and the pipeline writes the two
 * in separate statements, so a claim's status is always checked against this
 * record.
 */
export const VERIFICATION_AUDIT_ENTITY = 'verification';
export const VERIFICATION_COMPLETE_ACTION = 'complete';

export const DEFAULT_VERIFICATION_THRESHOLD = 0.7;

/**
 * Claim statuses a claim can only reach once its verification passed.
 */
export const VERIFICATION_REQUIRED_STATUSES: ClaimStatus[] = [
  ClaimStatus.verified,
  ClaimStatus.approved,
  ClaimStatus.disbursed,
];

/**
 * Statuses the reconciliation scan covers: the one that awaits a verification
 * (`requested`) plus the ones that presuppose it. `archived` and `cancelled`
 * claims are excluded - they can legitimately have no verification record.
 */
export const RECONCILED_CLAIM_STATUSES: ClaimStatus[] = [
  ClaimStatus.requested,
  ...VERIFICATION_REQUIRED_STATUSES,
];

/**
 * How a claim's stored status and its verification record disagree.
 *
 * - `verified_without_verification_record`: the claim moved past `requested`
 *   while no passing verification record exists - a partial write, a crashed
 *   worker, or a manual status flip.
 * - `verification_record_not_reflected`: the pipeline recorded a passing
 *   verification but the claim row never left `requested`.
 */
export type ClaimVerificationDrift =
  | 'verified_without_verification_record'
  | 'verification_record_not_reflected';

/**
 * The verification record the pipeline left for a claim.
 */
export interface ClaimVerificationRecord {
  claimId: string;
  score: number | null;
  passed: boolean;
  completedAt: string;
}

/**
 * One answer to "is this claim's verification complete?".
 */
export interface ClaimVerificationState {
  claimId: string;
  claimStatus: ClaimStatus;
  record: ClaimVerificationRecord | null;
  /** True only while a passing verification record exists for the claim. */
  complete: boolean;
  drift: ClaimVerificationDrift | null;
}

/**
 * Minimal claim projection this service needs.
 */
export interface ClaimStatusSnapshot {
  id: string;
  status: ClaimStatus;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Single source of truth for claim verification completion.
 *
 * `ClaimStatus` and the verification pipeline's own lifecycle evolved
 * independently, so "is this claim verified?" had no single answer: the claim
 * row carries a status, the pipeline writes a separate record, and either half
 * can be read without the other. Every consumer - the API, the reconciliation
 * job, future guards - asks this service instead of reading one half and
 * assuming the other.
 */
@Injectable()
export class ClaimVerificationStateService {
  private readonly verificationThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.verificationThreshold =
      parseFloat(
        this.configService.get<string>('VERIFICATION_THRESHOLD') ||
          String(DEFAULT_VERIFICATION_THRESHOLD),
      ) || DEFAULT_VERIFICATION_THRESHOLD;
  }

  /**
   * Resolve a claim's verification state, or null when the claim is gone.
   */
  async getState(claimId: string): Promise<ClaimVerificationState | null> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: { id: true, status: true },
    });
    if (!claim) {
      return null;
    }

    const record = await this.findRecord(claimId);
    return this.buildState({ id: claim.id, status: claim.status }, record);
  }

  /**
   * Convenience wrapper for callers that only need the verdict.
   */
  async isVerificationComplete(claimId: string): Promise<boolean> {
    const state = await this.getState(claimId);
    return state?.complete === true;
  }

  /**
   * Resolve the state of many claims with two queries instead of two per
   * claim, for callers that scan (reconciliation).
   */
  async getStates(
    claims: ClaimStatusSnapshot[],
  ): Promise<ClaimVerificationState[]> {
    if (claims.length === 0) {
      return [];
    }

    const rows = await this.prisma.auditLog.findMany({
      where: {
        entity: VERIFICATION_AUDIT_ENTITY,
        action: VERIFICATION_COMPLETE_ACTION,
        deletedAt: null,
        entityId: { in: claims.map(claim => claim.id) },
      },
      orderBy: { timestamp: 'desc' },
    });

    const latest = new Map<string, ClaimVerificationRecord>();
    for (const row of rows) {
      // Rows arrive newest first, so the first record seen per claim wins.
      if (latest.has(row.entityId)) {
        continue;
      }
      latest.set(
        row.entityId,
        this.toRecord(row.entityId, row.metadata, row.timestamp),
      );
    }

    return claims.map(claim =>
      this.buildState(claim, latest.get(claim.id) ?? null),
    );
  }

  /**
   * The most recent verification record for a claim, if any.
   */
  async findRecord(claimId: string): Promise<ClaimVerificationRecord | null> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entity: VERIFICATION_AUDIT_ENTITY,
        action: VERIFICATION_COMPLETE_ACTION,
        deletedAt: null,
        entityId: claimId,
      },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });

    const row = rows[0];
    return row
      ? this.toRecord(row.entityId, row.metadata, row.timestamp)
      : null;
  }

  /**
   * Combine a claim status with its verification record into the single answer
   * both the claim side and the verification side read.
   */
  buildState(
    claim: ClaimStatusSnapshot,
    record: ClaimVerificationRecord | null,
  ): ClaimVerificationState {
    const complete = record !== null && record.passed;

    return {
      claimId: claim.id,
      claimStatus: claim.status,
      record,
      complete,
      drift: this.detectDrift(claim.status, complete),
    };
  }

  private detectDrift(
    status: ClaimStatus,
    complete: boolean,
  ): ClaimVerificationDrift | null {
    if (!complete && VERIFICATION_REQUIRED_STATUSES.includes(status)) {
      return 'verified_without_verification_record';
    }
    if (complete && status === ClaimStatus.requested) {
      return 'verification_record_not_reflected';
    }
    return null;
  }

  private toRecord(
    claimId: string,
    metadata: unknown,
    timestamp: Date,
  ): ClaimVerificationRecord {
    const meta = asRecord(metadata) ?? {};
    const score = typeof meta.score === 'number' ? meta.score : null;
    const recordedStatus = typeof meta.status === 'string' ? meta.status : null;

    return {
      claimId,
      score,
      // The pipeline records the status it applied; fall back to scoring the
      // recorded value against the configured threshold for records that
      // predate that field.
      passed:
        recordedStatus === ClaimStatus.verified ||
        (score !== null && score >= this.verificationThreshold),
      completedAt: timestamp.toISOString(),
    };
  }
}
