import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

import { Prisma } from '@prisma/client';

export interface AuditLogParams {
  actorId: string;
  entity: string;
  entityId: string;
  action: string;
  metadata?: Record<string, any>;
}

export interface AuditQuery {
  entity?: string;
  entityId?: string;
  actorId?: string;
  startTime?: string;
  endTime?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async record(params: AuditLogParams) {
    return this.prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        metadata: (params.metadata as Prisma.InputJsonValue) ?? {},
      },
    });
  }

  async findLogs(query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {};

    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.actorId) where.actorId = query.actorId;

    if (query.startTime || query.endTime) {
      where.timestamp = {};
      if (query.startTime) where.timestamp.gte = new Date(query.startTime);
      if (query.endTime) where.timestamp.lte = new Date(query.endTime);
    }

    return this.prisma.auditLog.findMany({
      where,
      orderBy: {
        timestamp: 'desc',
      },
    });
  }
}
