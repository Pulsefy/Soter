import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
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

export class ExportAuditQuery {
  from?: string;
  to?: string;
  entity?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export interface AnonymizedAuditLog {
  id: string;
  actorHash: string;
  entity: string;
  entityHash: string;
  action: string;
  timestamp: Date;
  metadata: unknown;
}

export interface ExportAuditResult {
  data: AnonymizedAuditLog[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  anonymize(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

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

  async exportLogs(query: ExportAuditQuery): Promise<ExportAuditResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (query.entity) where.entity = query.entity;

    if (query.from || query.to) {
      if (query.from && isNaN(Date.parse(query.from))) {
        throw new BadRequestException(`Invalid 'from' date: ${query.from}`);
      }
      if (query.to && isNaN(Date.parse(query.to))) {
        throw new BadRequestException(`Invalid 'to' date: ${query.to}`);
      }
      where.timestamp = {};
      if (query.from) where.timestamp.gte = new Date(query.from);
      if (query.to) where.timestamp.lte = new Date(query.to);
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const data: AnonymizedAuditLog[] = rows.map(row => ({
      id: row.id,
      actorHash: this.anonymize(row.actorId),
      entity: row.entity,
      entityHash: this.anonymize(row.entityId),
      action: row.action,
      timestamp: row.timestamp,
      metadata: row.metadata,
    }));

    return { data, total, page, limit };
  }

  buildCsv(rows: AnonymizedAuditLog[]): string {
    const escape = (value: string): string => {
      const str = value.replace(/"/g, '""');
      return `"${str}"`;
    };

    const header = 'id,actorHash,entity,entityHash,action,timestamp,metadata';
    const lines = rows.map(r => {
      const metadata = escape(JSON.stringify(r.metadata ?? ''));
      return [
        escape(r.id),
        escape(r.actorHash),
        escape(r.entity),
        escape(r.entityHash),
        escape(r.action),
        escape(r.timestamp.toISOString()),
        metadata,
      ].join(',');
    });
    return [header, ...lines].join('\r\n');
  }
}
