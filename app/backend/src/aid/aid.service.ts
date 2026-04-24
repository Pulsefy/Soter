import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../../cache/redis.service';
import { AiTaskWebhookDto, TaskStatus } from './dto/ai-task-webhook.dto';

@Injectable()
export class AidService {
  private readonly logger = new Logger(AidService.name);

  constructor(
    private auditService: AuditService,
    private redisService: RedisService,
  ) {}

  async createCampaign(data: Record<string, unknown>) {
    const campaignId = 'mock-c-id';
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

  async handleTaskWebhook(payload: AiTaskWebhookDto) {
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
