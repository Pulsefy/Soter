import { VerificationInboxEventsService } from './verification-inbox-events.service';

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma, VerificationStatus } from '@prisma/client';
import { LockEntityType } from './dto/review-lock.dto';

export interface InboxItem {
  id: string;
  status: VerificationStatus;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  nextStepMessage: string | null;
  deepLink: string;
  lock?: {
    lockedBy: string;
    lockedAt: Date;
    expiresAt: Date;
    remainingSeconds: number;
  } | null;
}

export interface InboxResponse {
  items: InboxItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface StatsResponse {
  pending_review: number;
  approved: number;
  rejected: number;
  needs_resubmission: number;
  total: number;
}

export interface InternalNoteResponse {
  id: string;
  entityType: string;
  entityId: string;
  content: string;
  authorId: string;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class VerificationInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    // Optional so consumers that construct this service without the SSE hub
    // keep working unchanged; when present, reviewer clients get live updates.
    @Optional()
    private readonly inboxEvents?: VerificationInboxEventsService,
  ) {}

  async getInbox(
    status?: string,
    page: number = 1,
    limit: number = 20,
    _userId?: string,
  ): Promise<InboxResponse> {
    const skip = (page - 1) * limit;

    const where: { deletedAt: null; status?: VerificationStatus } = {
      deletedAt: null,
    };

    if (status) {
      where.status = status as VerificationStatus;
    }

    const [items, total] = await Promise.all([
      this.prisma.verificationRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.verificationRequest.count({ where }),
    ]);

    // Get active locks for all items in a single query
    const itemIds = items.map(item => item.id);
    const now = new Date();

    const activeLocks = await this.prisma.reviewLock.findMany({
      where: {
        entityType: LockEntityType.VERIFICATION,
        entityId: { in: itemIds },
        status: 'active',
        expiresAt: { gt: now },
      },
    });

    const lockMap = new Map(activeLocks.map(lock => [lock.entityId, lock]));

    const totalPages = Math.ceil(total / limit);

    return {
      items: items.map(item => {
        const lock = lockMap.get(item.id);
        const remainingSeconds = lock
          ? Math.max(
              0,
              Math.floor((lock.expiresAt.getTime() - now.getTime()) / 1000),
            )
          : 0;

        return {
          id: item.id,
          status: item.status,
          createdAt: item.createdAt,
          reviewedAt: item.reviewedAt,
          reviewedBy: item.reviewedBy,
          rejectionReason: item.rejectionReason,
          nextStepMessage: item.nextStepMessage,
          deepLink: `/verification/${item.id}`,
          lock: lock
            ? {
                lockedBy: lock.lockedBy,
                lockedAt: lock.lockedAt,
                expiresAt: lock.expiresAt,
                remainingSeconds,
              }
            : null,
        };
      }),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getStats(): Promise<StatsResponse> {
    const stats = await this.prisma.verificationRequest.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: true,
    });

    const result: StatsResponse = {
      pending_review: 0,
      approved: 0,
      rejected: 0,
      needs_resubmission: 0,
      total: 0,
    };

    for (const stat of stats) {
      const statusKey = stat.status as keyof StatsResponse;
      result[statusKey] = stat._count;
      result.total += stat._count;
    }

    return result;
  }

  async updateStatus(
    id: string,
    status: VerificationStatus,
    reviewerId: string,
    nextStepMessage?: string,
    rejectionReason?: string,
    internalNote?: string,
  ) {
    const verification = await this.prisma.verificationRequest.findUnique({
      where: { id, deletedAt: null },
    });

    if (!verification) {
      throw new NotFoundException('Verification request not found');
    }

    if (
      verification.status === 'approved' ||
      verification.status === 'rejected'
    ) {
      throw new BadRequestException('Verification already processed');
    }

    const updateData: Prisma.VerificationRequestUpdateInput = {
      status,
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
    };
    if (nextStepMessage) {
      updateData.nextStepMessage = nextStepMessage;
    }
    if (rejectionReason) {
      updateData.rejectionReason = rejectionReason;
    }

    const updated = await this.prisma.verificationRequest.update({
      where: { id },
      data: updateData,
    });

    // Record audit trail
    await this.auditService.record({
      actorId: reviewerId,
      entity: 'VerificationRequest',
      entityId: id,
      action: `review_${status}`,
      metadata: {
        previousStatus: verification.status,
        newStatus: status,
        rejectionReason: rejectionReason ?? null,
        nextStepMessage: nextStepMessage ?? null,
        reviewedAt: updated.reviewedAt?.toISOString(),
      },
    });

    // Persist optional internal note
    if (internalNote) {
      await this.prisma.internalNote.create({
        data: {
          entityType: 'verification',
          entityId: id,
          content: internalNote,
          authorId: reviewerId,
          category: `review_${status}`,
        },
      });
    }

    // Fan out the review decision so connected reviewer clients update live
    // instead of polling. Bulk actions route through this method per item, so
    // they are covered by the same event.
    this.inboxEvents?.publish('inbox.item.updated', {
      verificationId: updated.id,
      status: updated.status,
      previousStatus: verification.status,
      reviewedBy: updated.reviewedBy,
      reviewedAt: updated.reviewedAt?.toISOString() ?? null,
      deepLink: `/verification/${updated.id}`,
    });

    return updated;
  }

  async getDetails(id: string) {
    const verification = await this.prisma.verificationRequest.findUnique({
      where: { id, deletedAt: null },
    });

    if (!verification) {
      throw new NotFoundException('Verification request not found');
    }

    // Get active lock status
    const now = new Date();
    const activeLock = await this.prisma.reviewLock.findFirst({
      where: {
        entityType: LockEntityType.VERIFICATION,
        entityId: id,
        status: 'active',
        expiresAt: { gt: now },
      },
    });

    return {
      id: verification.id,
      status: verification.status,
      createdAt: verification.createdAt,
      reviewedAt: verification.reviewedAt,
      reviewedBy: verification.reviewedBy,
      rejectionReason: verification.rejectionReason,
      nextStepMessage: verification.nextStepMessage,
      deepLink: `/verification/${verification.id}`,
      lock: activeLock
        ? {
            lockId: activeLock.id,
            lockedBy: activeLock.lockedBy,
            lockedAt: activeLock.lockedAt,
            expiresAt: activeLock.expiresAt,
            remainingSeconds: Math.max(
              0,
              Math.floor(
                (activeLock.expiresAt.getTime() - now.getTime()) / 1000,
              ),
            ),
          }
        : null,
    };
  }

  /**
   * Add an internal note to a verification request.
   */
  async addInternalNote(
    id: string,
    content: string,
    authorId: string,
    category?: string,
  ): Promise<InternalNoteResponse> {
    const verification = await this.prisma.verificationRequest.findUnique({
      where: { id, deletedAt: null },
    });

    if (!verification) {
      throw new NotFoundException('Verification request not found');
    }

    const note = await this.prisma.internalNote.create({
      data: {
        entityType: 'verification',
        entityId: id,
        content,
        authorId,
        category: category ?? null,
      },
    });

    await this.auditService.record({
      actorId: authorId,
      entity: 'VerificationRequest',
      entityId: id,
      action: 'internal_note_added',
      metadata: { noteId: note.id, category: category ?? null },
    });

    return note;
  }

  /**
   * List internal notes for a verification request.
   */
  async getInternalNotes(id: string): Promise<InternalNoteResponse[]> {
    const verification = await this.prisma.verificationRequest.findUnique({
      where: { id, deletedAt: null },
    });

    if (!verification) {
      throw new NotFoundException('Verification request not found');
    }

    return this.prisma.internalNote.findMany({
      where: { entityType: 'verification', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async bulkUpdateStatus(
    action: 'approve' | 'reject' | 'requeue',
    ids: string[],
    reviewerId: string,
    nextStepMessage?: string,
    rejectionReason?: string,
    internalNote?: string,
  ) {
    const succeeded: { id: string; status: string }[] = [];
    const failed: { id: string; error: string }[] = [];

    const status: VerificationStatus =
      action === 'approve'
        ? 'approved'
        : action === 'reject'
          ? 'rejected'
          : 'needs_resubmission';

    for (const id of ids) {
      try {
        const updated = await this.updateStatus(
          id,
          status,
          reviewerId,
          nextStepMessage,
          rejectionReason,
          internalNote,
        );

        succeeded.push({
          id: updated.id,
          status: updated.status,
        });
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      succeeded,
      failed,
    };
  }
}
