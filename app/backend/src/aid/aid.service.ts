import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AiTaskWebhookDto, TaskStatus } from './dto/ai-task-webhook.dto';

@Injectable()
export class AidService {
  constructor(private auditService: AuditService) {}

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
    // Log the task notification
    console.log(`[AI Webhook] Task ${payload.taskId} completed with status: ${payload.status}`);
    
    // Record audit log for the task completion
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
      },
    });

    // Handle based on task status
    switch (payload.status) {
      case TaskStatus.COMPLETED:
        // Task completed successfully - trigger any follow-up actions
        console.log(`[AI Webhook] Task ${payload.taskId} completed successfully`);
        if (payload.result) {
          console.log(`[AI Webhook] Result:`, payload.result);
        }
        break;
      case TaskStatus.FAILED:
        // Task failed - log error and potentially trigger alerts
        console.error(`[AI Webhook] Task ${payload.taskId} failed:`, payload.error);
        break;
      case TaskStatus.PROCESSING:
        console.log(`[AI Webhook] Task ${payload.taskId} is still processing`);
        break;
      default:
        console.log(`[AI Webhook] Task ${payload.taskId} status: ${payload.status}`);
    }

    return {
      received: true,
      taskId: payload.taskId,
      status: payload.status,
    };
  }
}
