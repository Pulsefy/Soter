import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { MetricsService } from 'src/audit/metrics.service';
import { AuditChainService } from './audit-chain.service';

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
    private chain: AuditChainService,
  ) {}

  anonymize(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  async record(params: AuditLogParams) {
    const end = this.metrics.dbQueryDuration.startTimer({
      operation: 'create',
      entity: 'AuditLog',
    });
    try {
      // Appends are hash-chained (tamper-evident); see
      // docs/audit-log-integrity.md. The chain service serializes concurrent
      // appends with a Postgres advisory lock and assigns the entry's
      // sequence, prevHash and entryHash atomically.
      const result = await this.chain.appendToChain(params);
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
        throw new AppException(
          ERROR_CODES.BAD_REQUEST,
          400,
          `Invalid 'from' date: ${query.from}`,
        );
      }
      if (query.to && isNaN(Date.parse(query.to))) {
        throw new AppException(
          ERROR_CODES.BAD_REQUEST,
          400,
          `Invalid 'to' date: ${query.to}`,
        );
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
