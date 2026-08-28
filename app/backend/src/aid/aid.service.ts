import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../../cache/redis.service';
import {
  AiVerificationWebhookDto,
  TaskStatus,
} from '../webhooks/dto/ai-verification-webhook.dto';
import { MetricsService } from '../observability/metrics/metrics.service';
import type { Prisma } from '@prisma/client';

export interface AidOrganizationContext {
  orgId?: string | null;
  ngoId?: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface ListAidPackagesParams {
  page?: number;
  size?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  search?: string;
  status?: string;
  token?: string;
}

@Injectable()
export class AidService {
  private readonly logger = new Logger(AidService.name);

  constructor(
    private auditService: AuditService,
    private redisService: RedisService,
    private metricsService: MetricsService,
    private prisma: PrismaService,
  ) {}

  async listAidPackages(
    params: ListAidPackagesParams,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const page = Math.max(1, params.page ?? 1);
    const size = Math.min(100, Math.max(1, params.size ?? 10));
    const sortBy = params.sortBy ?? 'id';
    const sortDirection = params.sortDirection ?? 'asc';
    const skip = (page - 1) * size;

    const where: Prisma.AidPackageWhereInput = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      const searchLower = params.search.toLowerCase();
      where.OR = [
        { id: { contains: searchLower, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.AidPackageOrderByWithRelationInput = {
      [sortBy]: sortDirection,
    };

    const [packages, total] = await Promise.all([
      this.prisma.aidPackage.findMany({
        where,
        orderBy,
        skip,
        take: size,
      }),
      this.prisma.aidPackage.count({ where }),
    ]);

    const totalPages = Math.ceil(total / size);

    return {
      data: packages,
      total,
      page,
      size,
      totalPages,
    };
  }

  async createCampaign(
    data: Record<string, unknown>,
    organizationContext?: AidOrganizationContext,
  ) {
    const requestedCampaignId =
      typeof data.campaignId === 'string' && data.campaignId.trim().length > 0
        ? data.campaignId.trim()
        : undefined;
    const organizationId =
      organizationContext?.orgId ?? organizationContext?.ngoId;

    // Prefer an explicit campaign reference and use the authenticated org as a
    // fallback while enforcing ownership for either resolution path.
    const campaign = requestedCampaignId
      ? await this.prisma.campaign.findUnique({
          where: { id: requestedCampaignId },
        })
      : organizationId
        ? await this.prisma.campaign.findFirst({
            where: organizationContext?.orgId
              ? { orgId: organizationId, deletedAt: null }
              : { ngoId: organizationId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    const belongsToOrganization =
      !organizationContext ||
      !organizationId ||
      (organizationContext.orgId
        ? campaign?.orgId === organizationId
        : campaign?.ngoId === organizationId);

    if (!campaign || !belongsToOrganization || campaign.deletedAt) {
      throw new BadRequestException(
        'A valid campaign could not be resolved from campaignId or the authenticated organization',
      );
    }

    const campaignId = campaign.id;
    await this.auditService.record({
      actorId: 'admin-id',
      entity: 'campaign',
      entityId: campaignId,
      action: 'create',
      metadata: data,
    });
    return { id: campaignId, ...data };
  }

  async updateCampaign(id: string, data: Record<string, unknown>) {
    await this.auditService.record({
      actorId: 'admin-id',
      entity: 'campaign',
      entityId: id,
      action: 'update',
      metadata: data,
    });
    return { id, ...data };
  }

  async archiveCampaign(id: string) {
    await this.auditService.record({
      actorId: 'admin-id',
      entity: 'campaign',
      entityId: id,
      action: 'archive',
    });
    return { id, archived: true };
  }

  async transitionClaim(id: string, fromStatus: string, toStatus: string) {
    await this.auditService.record({
      actorId: 'manager-id',
      entity: 'claim',
      entityId: id,
      action: 'transition',
      metadata: { from: fromStatus, to: toStatus },
    });
    return { id, status: toStatus };
  }

  async handleTaskWebhook(payload: AiVerificationWebhookDto) {
    const deliveryKey = `webhook:delivery:${payload.deliveryId}`;
    const isDuplicate = await this.redisService.get(deliveryKey);

    if (isDuplicate) {
      this.logger.warn(
        `[AI Webhook] Ignored duplicate delivery attempt: ${payload.deliveryId}`,
      );
      return {
        received: true,
        status: 'ignored',
        reason: 'duplicate_delivery',
      };
    }

    const payloadTs = new Date(payload.timestamp).getTime();
    const taskTsKey = `webhook:task_ts:${payload.taskId}`;
    const lastProcessedTs = await this.redisService.get<number>(taskTsKey);

    if (lastProcessedTs && payloadTs <= lastProcessedTs) {
      this.logger.warn(
        `[AI Webhook] Ignored stale payload for task ${payload.taskId}. Payload TS: ${payloadTs}, Last TS: ${lastProcessedTs}`,
      );
      await this.redisService.set(deliveryKey, true, 7 * 24 * 60 * 60);
      return { received: true, status: 'ignored', reason: 'stale_payload' };
    }

    await this.redisService.set(deliveryKey, true, 7 * 24 * 60 * 60); // Keep delivery signature for 7 days
    await this.redisService.set(taskTsKey, payloadTs, 30 * 24 * 60 * 60); // Keep task state TS for 30 days

    this.logger.log(
      `[AI Webhook] Task ${payload.taskId} completed with status: ${payload.status}`,
    );

    await this.auditService.record({
      actorId: 'ai-service',
      entity: 'ai_task',
      entityId: payload.taskId,
      action: payload.status,
      metadata: {
        taskType: payload.taskType,
        result: payload.result,
        error: payload.error,
        completedAt: payload.completedAt,
        deliveryId: payload.deliveryId,
        timestamp: payload.timestamp,
      },
    });

    switch (payload.status) {
      case TaskStatus.COMPLETED:
        this.logger.log(
          `[AI Webhook] Task ${payload.taskId} completed successfully`,
        );
        if (payload.result)
          this.logger.log(`[AI Webhook] Result:`, payload.result);
        break;
      case TaskStatus.FAILED:
        this.metricsService.incrementCallbackFailure(
          'ai_task_webhook',
          payload.error ?? 'task_failed',
        );
        this.logger.error(
          `[AI Webhook] Task ${payload.taskId} failed:`,
          payload.error,
        );
        break;
      case TaskStatus.PROCESSING:
        this.logger.log(
          `[AI Webhook] Task ${payload.taskId} is still processing`,
        );
        break;
    }

    return { received: true, taskId: payload.taskId, status: payload.status };
  }
}
