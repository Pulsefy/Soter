import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AcquireLockDto,
  ReleaseLockDto,
  RefreshLockDto,
  LockInfoResponse,
  LockConflictResponse,
  LockResponseCode,
  LockEntityType,
} from './dto/review-lock.dto';

export interface LockResult {
  success: boolean;
  lockId?: string;
  code: LockResponseCode;
  message: string;
  conflict?: LockConflictResponse;
  lockInfo?: LockInfoResponse;
}

@Injectable()
export class ReviewLockService {
  private readonly DEFAULT_LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  private readonly STALE_LOCK_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
  private readonly STALE_LOCK_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes after expiry

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Acquire a lock on an entity for review.
   * Returns conflict response if another user holds the lock.
   */
  async acquireLock(
    dto: AcquireLockDto,
    reviewerId: string,
  ): Promise<LockResult> {
    const durationMs = (dto.durationSeconds ?? 300) * 1000;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMs);

    // First, check for existing active lock
    const existingLock = await this.prisma.reviewLock.findFirst({
      where: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        status: 'active',
        expiresAt: { gt: now },
      },
    });

    if (existingLock) {
      // Lock exists and is active
      if (existingLock.lockedBy === reviewerId) {
        // Same user already has the lock - refresh it
        const refreshedLock = await this.refreshExistingLock(
          existingLock.id,
          dto.durationSeconds,
        );
        return {
          success: true,
          lockId: refreshedLock.id,
          code: LockResponseCode.ACQUIRED,
          message: 'Lock refreshed successfully',
          lockInfo: this.buildLockInfo(refreshedLock),
        };
      }

      // Different user holds the lock - return conflict
      return {
        success: false,
        code: LockResponseCode.ALREADY_LOCKED,
        message: `Entity is currently locked by another reviewer`,
        conflict: this.buildConflictResponse(existingLock),
      };
    }

    // Clean up any stale locks for this entity before acquiring new one
    await this.cleanupStaleLocks(dto.entityType, dto.entityId);

    // Acquire the lock
    const lock = await this.prisma.reviewLock.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        lockedBy: reviewerId,
        lockedAt: now,
        expiresAt,
        status: 'active',
        version: 1,
      },
    });

    await this.auditService.record({
      actorId: reviewerId,
      entity: 'ReviewLock',
      entityId: lock.id,
      action: 'lock_acquired',
      metadata: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      success: true,
      lockId: lock.id,
      code: LockResponseCode.ACQUIRED,
      message: 'Lock acquired successfully',
      lockInfo: this.buildLockInfo(lock),
    };
  }

  /**
   * Release a lock held by a reviewer.
   * Only the lock owner can release their lock.
   */
  async releaseLock(
    dto: ReleaseLockDto,
    reviewerId: string,
  ): Promise<LockResult> {
    const lock = await this.prisma.reviewLock.findUnique({
      where: { id: dto.lockId },
    });

    if (!lock) {
      return {
        success: false,
        code: LockResponseCode.NOT_LOCKED,
        message: 'Lock not found',
      };
    }

    if (lock.status !== 'active') {
      return {
        success: false,
        code: LockResponseCode.NOT_LOCKED,
        message: 'Lock is not active',
      };
    }

    if (lock.lockedBy !== reviewerId) {
      return {
        success: false,
        code: LockResponseCode.NOT_OWNER,
        message: 'You do not own this lock',
        conflict: this.buildConflictResponse(lock),
      };
    }

    await this.prisma.reviewLock.update({
      where: { id: dto.lockId },
      data: {
        status: 'released',
        releasedAt: new Date(),
        releaseReason: 'manual',
      },
    });

    await this.auditService.record({
      actorId: reviewerId,
      entity: 'ReviewLock',
      entityId: lock.id,
      action: 'lock_released',
      metadata: {
        entityType: lock.entityType,
        entityId: lock.entityId,
        durationMs: Date.now() - lock.lockedAt.getTime(),
      },
    });

    return {
      success: true,
      lockId: lock.id,
      code: LockResponseCode.RELEASED,
      message: 'Lock released successfully',
    };
  }

  /**
   * Refresh an existing lock to extend its duration.
   * Only the lock owner can refresh their lock.
   */
  async refreshLock(
    dto: RefreshLockDto,
    reviewerId: string,
  ): Promise<LockResult> {
    const lock = await this.prisma.reviewLock.findUnique({
      where: { id: dto.lockId },
    });

    if (!lock) {
      return {
        success: false,
        code: LockResponseCode.NOT_LOCKED,
        message: 'Lock not found',
      };
    }

    if (lock.status !== 'active') {
      return {
        success: false,
        code: LockResponseCode.EXPIRED,
        message: 'Lock is no longer active',
      };
    }

    if (lock.lockedBy !== reviewerId) {
      return {
        success: false,
        code: LockResponseCode.NOT_OWNER,
        message: 'You do not own this lock',
        conflict: this.buildConflictResponse(lock),
      };
    }

    const refreshedLock = await this.refreshExistingLock(
      lock.id,
      dto.durationSeconds,
    );

    await this.auditService.record({
      actorId: reviewerId,
      entity: 'ReviewLock',
      entityId: lock.id,
      action: 'lock_refreshed',
      metadata: {
        entityType: lock.entityType,
        entityId: lock.entityId,
        newExpiresAt: refreshedLock.expiresAt.toISOString(),
      },
    });

    return {
      success: true,
      lockId: refreshedLock.id,
      code: LockResponseCode.ACQUIRED,
      message: 'Lock refreshed successfully',
      lockInfo: this.buildLockInfo(refreshedLock),
    };
  }

  /**
   * Get the current lock status for an entity.
   */
  async getLockStatus(
    entityType: LockEntityType,
    entityId: string,
  ): Promise<LockInfoResponse | null> {
    const now = new Date();

    // Clean up expired locks first
    await this.cleanupStaleLocks(entityType, entityId);

    const lock = await this.prisma.reviewLock.findFirst({
      where: {
        entityType,
        entityId,
        status: 'active',
        expiresAt: { gt: now },
      },
    });

    if (!lock) {
      return null;
    }

    return this.buildLockInfo(lock);
  }

  /**
   * Check if an entity is locked and verify the reviewer owns the lock.
   * Used before performing review actions.
   */
  async verifyLockOwnership(
    entityType: LockEntityType,
    entityId: string,
    reviewerId: string,
  ): Promise<LockResult> {
    const now = new Date();

    const lock = await this.prisma.reviewLock.findFirst({
      where: {
        entityType,
        entityId,
        status: 'active',
        expiresAt: { gt: now },
      },
    });

    if (!lock) {
      return {
        success: false,
        code: LockResponseCode.NOT_LOCKED,
        message: 'No active lock found on this entity',
      };
    }

    if (lock.lockedBy !== reviewerId) {
      return {
        success: false,
        code: LockResponseCode.CONFLICT,
        message: 'Lock is held by another reviewer',
        conflict: this.buildConflictResponse(lock),
      };
    }

    return {
      success: true,
      lockId: lock.id,
      code: LockResponseCode.ACQUIRED,
      message: 'Lock verified',
      lockInfo: this.buildLockInfo(lock),
    };
  }

  /**
   * Release a lock as part of completing a review action.
   * Used internally after approve/reject actions complete.
   */
  async releaseLockForReview(
    entityType: LockEntityType,
    entityId: string,
    reviewerId: string,
  ): Promise<void> {
    const now = new Date();

    const lock = await this.prisma.reviewLock.findFirst({
      where: {
        entityType,
        entityId,
        status: 'active',
        lockedBy: reviewerId,
        expiresAt: { gt: now },
      },
    });

    if (lock) {
      await this.prisma.reviewLock.update({
        where: { id: lock.id },
        data: {
          status: 'released',
          releasedAt: new Date(),
          releaseReason: 'review_completed',
        },
      });

      await this.auditService.record({
        actorId: reviewerId,
        entity: 'ReviewLock',
        entityId: lock.id,
        action: 'lock_released_review_complete',
        metadata: {
          entityType,
          entityId,
        },
      });
    }
  }

  /**
   * Recover stale locks that have expired but weren't properly released.
   * Should be called periodically (e.g., via a scheduled job).
   */
  async recoverStaleLocks(): Promise<number> {
    const now = new Date();
    const staleThreshold = new Date(
      now.getTime() - this.STALE_LOCK_THRESHOLD_MS,
    );

    const result = await this.prisma.reviewLock.updateMany({
      where: {
        status: 'active',
        expiresAt: {
          lt: staleThreshold,
          gt: new Date(0), // Ensure we don't expire non-expiring locks
        },
      },
      data: {
        status: 'force_expired',
        releasedAt: now,
        releaseReason: 'stale_lock_recovery',
      },
    });

    if (result.count > 0) {
      await this.auditService.record({
        actorId: 'system',
        entity: 'ReviewLock',
        entityId: 'batch_recovery',
        action: 'stale_locks_recovered',
        metadata: {
          recoveredCount: result.count,
          staleThreshold: staleThreshold.toISOString(),
        },
      });
    }

    return result.count;
  }

  /**
   * Get all locks held by a specific reviewer.
   */
  async getLocksByReviewer(reviewerId: string): Promise<LockInfoResponse[]> {
    const now = new Date();

    const locks = await this.prisma.reviewLock.findMany({
      where: {
        lockedBy: reviewerId,
        status: 'active',
        expiresAt: { gt: now },
      },
      orderBy: { lockedAt: 'desc' },
    });

    return locks.map(lock => this.buildLockInfo(lock));
  }

  /**
   * Get lock statistics for monitoring.
   */
  async getLockStats(): Promise<{
    activeLocks: number;
    staleLocks: number;
    totalLocks: number;
    locksByEntityType: Record<string, number>;
  }> {
    const now = new Date();
    const staleThreshold = new Date(
      now.getTime() - this.STALE_LOCK_THRESHOLD_MS,
    );

    const [activeLocks, staleLocks, totalLocks, locksByEntityType] =
      await Promise.all([
        this.prisma.reviewLock.count({
          where: { status: 'active', expiresAt: { gt: now } },
        }),
        this.prisma.reviewLock.count({
          where: {
            status: 'active',
            expiresAt: { lt: staleThreshold },
          },
        }),
        this.prisma.reviewLock.count(),
        this.prisma.reviewLock.groupBy({
          by: ['entityType'],
          where: { status: 'active', expiresAt: { gt: now } },
          _count: true,
        }),
      ]);

    const byType: Record<string, number> = {};
    for (const item of locksByEntityType) {
      byType[item.entityType] = item._count;
    }

    return {
      activeLocks,
      staleLocks,
      totalLocks,
      locksByEntityType: byType,
    };
  }

  // Private helper methods

  private async refreshExistingLock(
    lockId: string,
    durationSeconds?: number,
  ): Promise<{
    id: string;
    expiresAt: Date;
    lockedBy: string;
    entityType: string;
    entityId: string;
    lockedAt: Date;
  }> {
    const durationMs = (durationSeconds ?? 300) * 1000;
    const newExpiresAt = new Date(Date.now() + durationMs);

    return this.prisma.reviewLock.update({
      where: { id: lockId },
      data: {
        expiresAt: newExpiresAt,
        version: { increment: 1 },
      },
    });
  }

  private async cleanupStaleLocks(
    entityType: string,
    entityId: string,
  ): Promise<void> {
    const now = new Date();
    const staleThreshold = new Date(
      now.getTime() - this.STALE_LOCK_THRESHOLD_MS,
    );

    await this.prisma.reviewLock.updateMany({
      where: {
        entityType,
        entityId,
        status: 'active',
        expiresAt: { lt: staleThreshold },
      },
      data: {
        status: 'force_expired',
        releasedAt: now,
        releaseReason: 'stale_cleanup',
      },
    });
  }

  private buildLockInfo(lock: {
    id: string;
    entityType: string;
    entityId: string;
    lockedBy: string;
    lockedAt: Date;
    expiresAt: Date;
  }): LockInfoResponse {
    const now = new Date();
    const remainingMs = lock.expiresAt.getTime() - now.getTime();
    const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

    return {
      lockId: lock.id,
      entityType: lock.entityType,
      entityId: lock.entityId,
      lockedBy: lock.lockedBy,
      lockedAt: lock.lockedAt.toISOString(),
      expiresAt: lock.expiresAt.toISOString(),
      code: LockResponseCode.ACQUIRED,
      message: 'Lock is active',
      remainingSeconds,
    };
  }

  private buildConflictResponse(lock: {
    lockedBy: string;
    lockedAt: Date;
    expiresAt: Date;
  }): LockConflictResponse {
    const now = new Date();
    const remainingMs = lock.expiresAt.getTime() - now.getTime();
    const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

    let suggestedAction: 'refresh_page' | 'try_again_later' | 'force_refresh';
    if (remainingSeconds > 60) {
      suggestedAction = 'try_again_later';
    } else if (remainingSeconds > 10) {
      suggestedAction = 'refresh_page';
    } else {
      suggestedAction = 'force_refresh';
    }

    return {
      code: LockResponseCode.ALREADY_LOCKED,
      message: 'Entity is currently locked by another reviewer',
      lockedBy: lock.lockedBy,
      lockedAt: lock.lockedAt.toISOString(),
      expiresAt: lock.expiresAt.toISOString(),
      remainingSeconds,
      suggestedAction,
    };
  }
}
