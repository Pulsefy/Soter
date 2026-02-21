import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';

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
}
