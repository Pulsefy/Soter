import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage/storage.service';
import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import * as fs from 'fs/promises';

export interface OrphanScanOptions {
  gracePeriodHours?: number;
  dryRun?: boolean;
  orgId?: string;
  limit?: number;
}

export interface OrphanedArtifactItem {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
  orgId: string | null;
  ownerId: string;
  status: string;
  storageKey: string | null;
  filePath: string | null;
  flaggedForReview: boolean;
  flaggedForReviewAt?: string;
  reviewStatus?: string;
  orphanReason?: string;
}

export interface OrphanReport {
  totalCount: number;
  totalSizeBytes: number;
  flaggedCount: number;
  flaggedSizeBytes: number;
  unflaggedCount: number;
  unflaggedSizeBytes: number;
  gracePeriodHours: number;
  cutoffDate: string;
  items: OrphanedArtifactItem[];
  generatedAt: string;
}

export interface OrphanScanResult {
  dryRun: boolean;
  gracePeriodHours: number;
  cutoffDate: string;
  orphansFound: number;
  newlyFlagged: number;
  alreadyFlagged: number;
  totalSizeBytes: number;
  action: 'detected_only' | 'flagged_for_review';
  orphans: OrphanedArtifactItem[];
  timestamp: string;
}

@Injectable()
export class OrphanedArtifactsService {
  private readonly logger = new Logger(OrphanedArtifactsService.name);
  private readonly defaultGracePeriodHours: number;
  private readonly defaultDryRun: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {
    const configuredGrace = this.configService.get<string>(
      'ORPHAN_ARTIFACT_GRACE_PERIOD_HOURS',
    );
    this.defaultGracePeriodHours = configuredGrace
      ? Number(configuredGrace)
      : 24;

    const dryRunEnv = this.configService.get<string>(
      'ORPHAN_ARTIFACTS_DRY_RUN',
    );
    // Defaults to true when explicitly set to 'true', otherwise can be set via env
    this.defaultDryRun = dryRunEnv === 'true';
  }

  /**
   * Identifies artifacts with no corresponding live claim or verification record
   * past the specified grace period.
   */
  async identifyOrphans(options?: OrphanScanOptions): Promise<{
    orphans: OrphanedArtifactItem[];
    totalSizeBytes: number;
    cutoffDate: Date;
    gracePeriodHours: number;
  }> {
    const gracePeriodHours =
      options?.gracePeriodHours ?? this.defaultGracePeriodHours;
    const cutoffDate = new Date(Date.now() - gracePeriodHours * 60 * 60 * 1000);

    const whereClause: any = {
      createdAt: {
        lte: cutoffDate,
      },
    };
    if (options?.orgId) {
      whereClause.orgId = options.orgId;
    }

    const items = await this.prisma.evidenceQueueItem.findMany({
      where: whereClause,
      take: options?.limit,
      orderBy: { createdAt: 'asc' },
    });

    if (items.length === 0) {
      return {
        orphans: [],
        totalSizeBytes: 0,
        cutoffDate,
        gracePeriodHours,
      };
    }

    // 1. Gather all candidate IDs from artifact metadata and fields
    const candidateClaimIds = new Set<string>();
    const candidateEvidenceRefs = new Set<string>();
    const candidateVerificationRequestIds = new Set<string>();

    for (const item of items) {
      const metadata = (item.metadata as Record<string, any>) || {};
      const claimId = metadata.claimId || metadata.claim_id;
      if (typeof claimId === 'string' && claimId.trim().length > 0) {
        candidateClaimIds.add(claimId.trim());
      }

      if (item.id) candidateEvidenceRefs.add(item.id);
      if (item.storageKey) candidateEvidenceRefs.add(item.storageKey);
      if (item.fileName) candidateEvidenceRefs.add(item.fileName);

      const verificationId =
        metadata.verificationRequestId ||
        metadata.verification_request_id ||
        metadata.verificationId;
      if (
        typeof verificationId === 'string' &&
        verificationId.trim().length > 0
      ) {
        candidateVerificationRequestIds.add(verificationId.trim());
      }
    }

    // 2. Query live (non-deleted) claims matching either ID or evidenceRef
    const liveClaims = await this.prisma.claim.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(candidateClaimIds.size > 0
            ? [{ id: { in: Array.from(candidateClaimIds) } }]
            : []),
          ...(candidateEvidenceRefs.size > 0
            ? [{ evidenceRef: { in: Array.from(candidateEvidenceRefs) } }]
            : []),
        ],
      },
      select: {
        id: true,
        evidenceRef: true,
      },
    });

    const activeClaimIds = new Set<string>(liveClaims.map(c => c.id));
    const activeEvidenceRefs = new Set<string>(
      liveClaims
        .map(c => c.evidenceRef)
        .filter((ref): ref is string => Boolean(ref)),
    );

    // 3. Query live (non-deleted) verification requests matching candidate IDs
    let activeVerificationRequestIds = new Set<string>();
    if (candidateVerificationRequestIds.size > 0) {
      const liveVerifications = await this.prisma.verificationRequest.findMany({
        where: {
          deletedAt: null,
          id: { in: Array.from(candidateVerificationRequestIds) },
        },
        select: { id: true },
      });
      activeVerificationRequestIds = new Set<string>(
        liveVerifications.map(v => v.id),
      );
    }

    // 4. Determine orphaned artifacts
    const orphans: OrphanedArtifactItem[] = [];
    let totalSizeBytes = 0;

    for (const item of items) {
      const metadata = (item.metadata as Record<string, any>) || {};
      const claimId = (metadata.claimId || metadata.claim_id) as
        string | undefined;
      const verificationId = (metadata.verificationRequestId ||
        metadata.verification_request_id ||
        metadata.verificationId) as string | undefined;

      const hasLiveClaimById = claimId ? activeClaimIds.has(claimId) : false;
      const hasLiveClaimByRef =
        activeEvidenceRefs.has(item.id) ||
        (item.storageKey ? activeEvidenceRefs.has(item.storageKey) : false) ||
        (item.fileName ? activeEvidenceRefs.has(item.fileName) : false);
      const hasLiveVerification = verificationId
        ? activeVerificationRequestIds.has(verificationId)
        : false;

      // An artifact is orphaned if it has NO corresponding live claim or verification record
      if (!hasLiveClaimById && !hasLiveClaimByRef && !hasLiveVerification) {
        const isFlagged = Boolean(metadata.flaggedForReview);
        orphans.push({
          id: item.id,
          fileName: item.fileName,
          size: item.size,
          mimeType: item.mimeType,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          orgId: item.orgId,
          ownerId: item.ownerId,
          status: item.status,
          storageKey: item.storageKey,
          filePath: item.filePath,
          flaggedForReview: isFlagged,
          flaggedForReviewAt: metadata.flaggedForReviewAt,
          reviewStatus: metadata.reviewStatus,
          orphanReason: metadata.orphanReason,
        });
        totalSizeBytes += item.size;
      }
    }

    return {
      orphans,
      totalSizeBytes,
      cutoffDate,
      gracePeriodHours,
    };
  }

  /**
   * Scans and processes orphaned artifacts.
   * In dry-run mode, finds and reports orphans without modifying them.
   * In live mode, flags orphaned artifacts for review before any eventual deletion.
   */
  async processOrphanedArtifacts(
    options?: OrphanScanOptions,
  ): Promise<OrphanScanResult> {
    const dryRun = options?.dryRun ?? this.defaultDryRun;
    const { orphans, totalSizeBytes, cutoffDate, gracePeriodHours } =
      await this.identifyOrphans(options);

    let newlyFlagged = 0;
    let alreadyFlagged = 0;

    if (!dryRun) {
      for (const orphan of orphans) {
        if (orphan.flaggedForReview) {
          alreadyFlagged++;
          continue;
        }

        const currentItem = await this.prisma.evidenceQueueItem.findUnique({
          where: { id: orphan.id },
          select: { metadata: true },
        });

        const currentMeta =
          (currentItem?.metadata as Record<string, any>) || {};
        const updatedMeta = {
          ...currentMeta,
          isOrphan: true,
          flaggedForReview: true,
          flaggedForReviewAt: new Date().toISOString(),
          orphanReason:
            'No corresponding claim or verification record past grace period',
          reviewStatus: 'pending_review',
        };

        await this.prisma.evidenceQueueItem.update({
          where: { id: orphan.id },
          data: { metadata: updatedMeta },
        });

        orphan.flaggedForReview = true;
        orphan.flaggedForReviewAt = updatedMeta.flaggedForReviewAt;
        orphan.reviewStatus = updatedMeta.reviewStatus;
        orphan.orphanReason = updatedMeta.orphanReason;
        newlyFlagged++;

        await this.auditService.record({
          actorId: 'system',
          entity: 'evidence_queue',
          entityId: orphan.id,
          action: 'orphan_flagged_for_review',
          metadata: {
            fileName: orphan.fileName,
            size: orphan.size,
            orgId: orphan.orgId,
            gracePeriodHours,
          },
        });
      }

      this.logger.log(
        `Orphan scan completed: ${orphans.length} orphans found (${newlyFlagged} newly flagged, ${alreadyFlagged} already flagged), total size: ${totalSizeBytes} bytes`,
      );
    } else {
      for (const orphan of orphans) {
        if (orphan.flaggedForReview) {
          alreadyFlagged++;
        } else {
          newlyFlagged++;
        }
      }
      this.logger.log(
        `[DRY RUN] Orphan scan completed: ${orphans.length} orphans identified (${newlyFlagged} would be flagged, ${alreadyFlagged} already flagged), total size: ${totalSizeBytes} bytes`,
      );
    }

    return {
      dryRun,
      gracePeriodHours,
      cutoffDate: cutoffDate.toISOString(),
      orphansFound: orphans.length,
      newlyFlagged,
      alreadyFlagged,
      totalSizeBytes,
      action: dryRun ? 'detected_only' : 'flagged_for_review',
      orphans,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Produces an orphan summary and detailed report for administrators.
   */
  async getOrphanReport(options?: OrphanScanOptions): Promise<OrphanReport> {
    const { orphans, totalSizeBytes, cutoffDate, gracePeriodHours } =
      await this.identifyOrphans(options);

    let flaggedCount = 0;
    let flaggedSizeBytes = 0;
    let unflaggedCount = 0;
    let unflaggedSizeBytes = 0;

    for (const item of orphans) {
      if (item.flaggedForReview) {
        flaggedCount++;
        flaggedSizeBytes += item.size;
      } else {
        unflaggedCount++;
        unflaggedSizeBytes += item.size;
      }
    }

    return {
      totalCount: orphans.length,
      totalSizeBytes,
      flaggedCount,
      flaggedSizeBytes,
      unflaggedCount,
      unflaggedSizeBytes,
      gracePeriodHours,
      cutoffDate: cutoffDate.toISOString(),
      items: orphans,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Allows an admin to delete an orphaned artifact that has been reviewed.
   * Safety guard: requires the artifact to have been flagged for review first.
   */
  async deleteReviewedOrphan(
    id: string,
    adminId: string,
  ): Promise<{ message: string; deletedId: string; reclaimedBytes: number }> {
    const item = await this.prisma.evidenceQueueItem.findUnique({
      where: { id },
    });

    if (!item) {
      throw new AppException(
        ERROR_CODES.NOT_FOUND,
        404,
        'Evidence artifact not found',
      );
    }

    const metadata = (item.metadata as Record<string, any>) || {};
    if (!metadata.flaggedForReview) {
      throw new AppException(
        ERROR_CODES.BAD_REQUEST,
        400,
        'Artifact must be flagged for review before deletion',
      );
    }

    // Remove from durable storage if stored
    if (item.storageKey) {
      try {
        await this.storageService.remove(item.storageKey);
      } catch (err) {
        this.logger.warn(
          `Failed to delete stored artifact ${item.storageKey}: ${(err as Error).message}`,
        );
      }
    }

    // Clean up staging file if present
    if (item.filePath) {
      try {
        await fs.unlink(item.filePath);
      } catch (err) {
        this.logger.warn(
          `Failed to delete staging file ${item.filePath}: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.evidenceQueueItem.delete({
      where: { id },
    });

    await this.auditService.record({
      actorId: adminId,
      entity: 'evidence_queue',
      entityId: id,
      action: 'reviewed_orphan_deleted',
      metadata: {
        fileName: item.fileName,
        size: item.size,
        orgId: item.orgId,
      },
    });

    return {
      message: 'Reviewed orphaned artifact deleted successfully',
      deletedId: id,
      reclaimedBytes: item.size,
    };
  }
}
