import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { MetricsService } from 'src/audit/metrics.service';

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
  action?: string;
  startTime?: string;
  endTime?: string;
  page?: number;
  limit?: number;
}

export class ExportAuditQuery {
  from?: string;
  to?: string;
  entity?: string;
  action?: string;
  actorId?: string;

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
  constructor(
    private prisma: PrismaService,
    private metrics: MetricsService,
  ) {}

  anonymize(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  generateHash(payload: { actorId: string, entity: string, entityId: string, action: string, metadata: any }, previousHash: string | null): string {
    const data = JSON.stringify({
      actorId: payload.actorId,
      entity: payload.entity,
      entityId: payload.entityId,
      action: payload.action,
      metadata: payload.metadata ?? null,
      previousHash: previousHash
    });
    return createHash('sha256').update(data).digest('hex');
  }

  async verifyChain(): Promise<{ valid: boolean; errors: string[] }> {
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { timestamp: 'asc' },
    });
    
    const errors: string[] = [];
    let expectedPreviousHash: string | null = null;
    
    for (const log of logs) {
      if (log.previousHash !== expectedPreviousHash) {
        errors.push(`Chain broken at log ${log.id}: expected previousHash ${expectedPreviousHash}, got ${log.previousHash}`);
      }
      
      const computedHash = this.generateHash({
        actorId: log.actorId,
        entity: log.entity,
        entityId: log.entityId,
        action: log.action,
        metadata: log.metadata,
      }, log.previousHash);
      
      if (log.hash !== computedHash) {
        errors.push(`Tampering detected at log ${log.id}: computed hash ${computedHash} does not match stored hash ${log.hash}`);
      }
      expectedPreviousHash = log.hash;
    }
    
    return { valid: errors.length === 0, errors };
  }

  async record(params: AuditLogParams) {
    const end = this.metrics.dbQueryDuration.startTimer({
      operation: 'create',
      entity: 'AuditLog',
    });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const lastLog = await tx.auditLog.findFirst({
          orderBy: { timestamp: 'desc' },
        });
        const previousHash = lastLog?.hash || null;
        
        const payload = {
          actorId: params.actorId,
          entity: params.entity,
          entityId: params.entityId,
          action: params.action,
          metadata: (params.metadata as Prisma.InputJsonValue) ?? {},
        };
        const hash = this.generateHash(payload, previousHash);

        return tx.auditLog.create({
          data: {
            ...payload,
            hash,
            previousHash,
          },
        });
      });
      end();
      return result;
    } catch (error) {
      this.metrics.dbErrorsTotal.inc({
        operation: 'create',
        entity: 'AuditLog',
      });
      end();
      throw error;
    }
  }

  async findLogs(query: AuditQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;

    if (query.startTime || query.endTime) {
      where.timestamp = {};
      if (query.startTime) where.timestamp.gte = new Date(query.startTime);
      if (query.endTime) where.timestamp.lte = new Date(query.endTime);
    }

    const end = this.metrics.dbQueryDuration.startTimer({
      operation: 'findMany',
      entity: 'AuditLog',
    });
    try {
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.auditLog.count({ where }),
      ]);
      end();
      return { data: rows, total, page, limit };
    } catch (error) {
      this.metrics.dbErrorsTotal.inc({
        operation: 'findMany',
        entity: 'AuditLog',
      });
      end();
      throw error;
    }
  }

  async exportLogs(query: ExportAuditQuery): Promise<ExportAuditResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};

    if (query.entity) where.entity = query.entity;
    if (query.action) where.action = query.action;
    if (query.actorId) where.actorId = query.actorId;

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

    const end = this.metrics.dbQueryDuration.startTimer({
      operation: 'export',
      entity: 'AuditLog',
    });
    try {
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.auditLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.auditLog.count({ where }),
      ]);
      end();

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
    } catch (error) {
      this.metrics.dbErrorsTotal.inc({
        operation: 'export',
        entity: 'AuditLog',
      });
      end();
      throw error;
    }
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
