import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  CampaignStatus,
  ClaimStatus,
  Prisma,
  PrismaClientKnownRequestError,
} from '@prisma/client';
import { CreateVerificationDto } from './dto/create-verification.dto';
import {
  ReviewQueuePaginationMode,
  ReviewQueueQueryDto,
} from './dto/review-queue-query.dto';
import {
  VerificationJobData,
  VerificationResult,
} from './interfaces/verification-job.interface';
import { AuditService } from '../audit/audit.service';

type ReviewQueueCursorPayload = {
  createdAt: string;
  id: string;
};

type ReviewQueueItem = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: ClaimStatus;
  campaignId: string;
  amount: Prisma.Decimal;
  recipientRef: string;
  evidenceRef: string | null;
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    archivedAt: Date | null;
  };
};

type ReviewQueueResponse = {
  items: ReviewQueueItem[];
  pagination:
    | {
        mode: 'page';
        page: number;
        limit: number;
        totalItems: number;
        totalPages: number;
        hasNextPage: boolean;
      }
    | {
        mode: 'cursor';
        limit: number;
        nextCursor: string | null;
        hasNextPage: boolean;
      };
  filters: {
    status?: ClaimStatus[];
    campaignId?: string;
    fromDate?: string;
    toDate?: string;
  };
};

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly verificationMode: string;
  private readonly verificationThreshold: number;

  constructor(
    @InjectQueue('verification') private verificationQueue: Queue,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {
    this.verificationMode =
      this.configService.get<string>('VERIFICATION_MODE') || 'mock';
    this.verificationThreshold =
      parseFloat(
        this.configService.get<string>('VERIFICATION_THRESHOLD') || '0.7',
      ) || 0.7;
  }

  async enqueueVerification(claimId: string): Promise<{ jobId: string }> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }

    if (claim.status === 'verified') {
      this.logger.warn(`Claim ${claimId} is already verified`);
      return { jobId: 'already-verified' };
    }

    const jobData: VerificationJobData = {
      claimId,
      timestamp: Date.now(),
    };

    const job = await this.verificationQueue.add('verify-claim', jobData, {
      attempts: parseInt(
        this.configService.get<string>('QUEUE_MAX_RETRIES') || '3',
      ),
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.logger.log(`Enqueued verification job ${job.id} for claim ${claimId}`);

    await this.auditService.record({
      actorId: 'system',
      entity: 'verification',
      entityId: claimId,
      action: 'enqueue',
      metadata: { jobId: job.id || 'unknown' },
    });

    return { jobId: job.id || 'unknown' };
  }

  async processVerification(
    jobData: VerificationJobData,
  ): Promise<VerificationResult> {
    const { claimId } = jobData;

    this.logger.log(
      `Processing verification for claim ${claimId} in ${this.verificationMode} mode`,
    );

    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${claimId} not found`);
    }

    let result: VerificationResult;

    if (this.verificationMode === 'mock') {
      result = this.generateMockVerification(claim);
    } else {
      result = await this.performAIVerification(claim);
    }

    const shouldVerify = result.score >= this.verificationThreshold;

    await this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: shouldVerify ? 'verified' : 'requested',
      },
    });

    this.logger.log(
      `Claim ${claimId} verification completed with score ${result.score} (threshold: ${this.verificationThreshold})`,
    );

    await this.auditService.record({
      actorId: 'system',
      entity: 'verification',
      entityId: claimId,
      action: 'complete',
      metadata: {
        score: result.score,
        status: shouldVerify ? 'verified' : 'requested',
      },
    });

    return result;
  }

  private generateMockVerification(_claim: unknown): VerificationResult {
    const baseScore = 0.6 + Math.random() * 0.35;
    const score = Math.min(0.95, Math.max(0.5, baseScore));

    const factors = [
      'Document authenticity verified',
      'Identity cross-reference passed',
      'Historical data consistent',
      'No fraud indicators detected',
    ];

    const riskLevel: 'low' | 'medium' | 'high' =
      score >= 0.8 ? 'low' : score >= 0.65 ? 'medium' : 'high';

    return {
      score: parseFloat(score.toFixed(3)),
      confidence: parseFloat((0.85 + Math.random() * 0.1).toFixed(3)),
      details: {
        factors: factors.slice(0, Math.floor(Math.random() * 2) + 2),
        riskLevel,
        recommendations:
          riskLevel !== 'low'
            ? [
                'Manual review recommended',
                'Additional documentation may be required',
              ]
            : undefined,
      },
      processedAt: new Date(),
    };
  }

  private performAIVerification(_claim: unknown): Promise<VerificationResult> {
    throw new Error(
      'AI verification mode not yet implemented. Use VERIFICATION_MODE=mock',
    );
  }

  create(_createVerificationDto: CreateVerificationDto) {
    return 'This action adds a new verification';
  }

  async findAll() {
    return Promise.resolve([]);
  }

  async findOne(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    return claim;
  }

  async findByUser(_userId: string) {
    return Promise.resolve([]);
  }

  async getReviewQueue(
    query: ReviewQueueQueryDto,
  ): Promise<ReviewQueueResponse> {
    const limit = query.limit ?? 20;
    const filters = this.buildReviewQueueFilters(query);
    const paginationMode = query.getPaginationMode();

    if (paginationMode === ReviewQueuePaginationMode.CURSOR) {
      const cursorFilter = query.cursor
        ? [this.buildCursorFilter(this.decodeReviewQueueCursor(query.cursor))]
        : [];
      const where = [...filters, ...cursorFilter];
      const items = await this.prisma.claim.findMany({
        where: where.length > 0 ? { AND: where } : undefined,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      const hasNextPage = items.length > limit;
      const pageItems = items.slice(0, limit) as ReviewQueueItem[];
      const nextCursor =
        hasNextPage && pageItems.length > 0
          ? this.encodeReviewQueueCursor(pageItems[pageItems.length - 1])
          : null;

      return {
        items: pageItems,
        pagination: {
          mode: 'cursor',
          limit,
          nextCursor,
          hasNextPage,
        },
        filters: this.buildAppliedFilters(query),
      };
    }

    const page = query.page ?? 1;
    const skip = (page - 1) * limit;
    const where = filters.length > 0 ? { AND: filters } : undefined;

    const [items, totalItems] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.claim.count({ where }),
    ]);

    return {
      items: items as ReviewQueueItem[],
      pagination: {
        mode: 'page',
        page,
        limit,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / limit),
        hasNextPage: skip + items.length < totalItems,
      },
      filters: this.buildAppliedFilters(query),
    };
  }

  async update(id: string, updateVerificationDto: Record<string, unknown>) {
    await this.auditService.record({
      actorId: 'system',
      entity: 'verification',
      entityId: id,
      action: 'update',
      metadata: updateVerificationDto,
    });
    return { id, message: 'Verification updated' };
  }

  async remove(id: string) {
    return Promise.resolve({ id, message: 'Removed' });
  }

  async getQueueMetrics() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.verificationQueue.getWaitingCount(),
      this.verificationQueue.getActiveCount(),
      this.verificationQueue.getCompletedCount(),
      this.verificationQueue.getFailedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      total: waiting + active + completed + failed,
    };
  }

  private buildReviewQueueFilters(
    query: ReviewQueueQueryDto,
  ): Prisma.ClaimWhereInput[] {
    const filters: Prisma.ClaimWhereInput[] = [];

    if (query.status?.length) {
      filters.push({
        status: {
          in: query.status,
        },
      });
    }

    if (query.campaignId) {
      filters.push({ campaignId: query.campaignId });
    }

    if (query.fromDate || query.toDate) {
      filters.push({
        createdAt: {
          ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
          ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
        },
      });
    }

    return filters;
  }

  private buildAppliedFilters(query: ReviewQueueQueryDto) {
    return {
      ...(query.status?.length ? { status: query.status } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.fromDate ? { fromDate: query.fromDate } : {}),
      ...(query.toDate ? { toDate: query.toDate } : {}),
    };
  }

  private buildCursorFilter(
    cursor: ReviewQueueCursorPayload,
  ): Prisma.ClaimWhereInput {
    const cursorCreatedAt = new Date(cursor.createdAt);

    return {
      OR: [
        {
          createdAt: {
            lt: cursorCreatedAt,
          },
        },
        {
          createdAt: cursorCreatedAt,
          id: {
            lt: cursor.id,
          },
        },
      ],
    };
  }

  private encodeReviewQueueCursor(
    item: Pick<ReviewQueueItem, 'createdAt' | 'id'>,
  ) {
    return Buffer.from(
      JSON.stringify({
        createdAt: item.createdAt.toISOString(),
        id: item.id,
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeReviewQueueCursor(cursor: string): ReviewQueueCursorPayload {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as {
        createdAt?: unknown;
        id?: unknown;
      };

      if (
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.id !== 'string'
      ) {
        throw new BadRequestException('Invalid review queue cursor');
      }

      const createdAt = new Date(parsed.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        throw new BadRequestException('Invalid review queue cursor');
      }

      return {
        createdAt: createdAt.toISOString(),
        id: parsed.id,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof PrismaClientKnownRequestError) {
        throw error;
      }

      throw new BadRequestException('Invalid review queue cursor');
    }
  }
}
