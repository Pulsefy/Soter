import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRetentionPolicyDto } from './dto/create-retention-policy.dto';
import { UpdateRetentionPolicyDto } from './dto/update-retention-policy.dto';

type PurgeStrategy = 'soft_delete' | 'hard_delete' | 'anonymize';

/** Shape returned by a purge run */
export interface PurgeResult {
  entity: string;
  strategy: string;
  affected: number;
  cutoffDate: Date;
}

/** Supported entities for retention */
const RETENTION_ENTITIES = [
  'AuditLog',
  'VerificationSession',
  'Session',
  'SessionSubmission',
  'Claim',
  'VerificationRequest',
] as const;

@Injectable()
export class RetentionPolicyService {
  private readonly logger = new Logger(RetentionPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(dto: CreateRetentionPolicyDto) {
    const existing = await this.prisma.retentionPolicy.findUnique({
      where: { entity: dto.entity },
    });
    if (existing) {
      throw new ConflictException(
        `Retention policy for entity "${dto.entity}" already exists`,
      );
    }

    return this.prisma.retentionPolicy.create({
      data: {
        entity: dto.entity,
        retentionDays: dto.retentionDays,
        strategy: dto.strategy ?? 'soft_delete',
        enabled: dto.enabled ?? true,
        description: dto.description,
      },
    });
  }

  async findAll() {
    return this.prisma.retentionPolicy.findMany({
      orderBy: { entity: 'asc' },
    });
  }

  async findOne(id: string) {
    const policy = await this.prisma.retentionPolicy.findUnique({
      where: { id },
    });
    if (!policy) {
      throw new NotFoundException(`Retention policy "${id}" not found`);
    }
    return policy;
  }

  async update(id: string, dto: UpdateRetentionPolicyDto) {
    await this.findOne(id); // ensure exists

    return this.prisma.retentionPolicy.update({
      where: { id },
      data: {
        ...(dto.entity !== undefined && { entity: dto.entity }),
        ...(dto.retentionDays !== undefined && {
          retentionDays: dto.retentionDays,
        }),
        ...(dto.strategy !== undefined && { strategy: dto.strategy }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // ensure exists
    return this.prisma.retentionPolicy.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Seed default policies
  // ---------------------------------------------------------------------------

  async seedDefaults(): Promise<void> {
    const defaults: {
      entity: string;
      retentionDays: number;
      strategy: PurgeStrategy;
      description: string;
    }[] = [
      {
        entity: 'AuditLog',
        retentionDays: 365,
        strategy: 'soft_delete',
        description: 'Audit logs are soft-deleted after 1 year',
      },
      {
        entity: 'VerificationSession',
        retentionDays: 180,
        strategy: 'hard_delete',
        description:
          'Verification sessions (OTP records) are hard-deleted after 180 days',
      },
      {
        entity: 'Session',
        retentionDays: 90,
        strategy: 'anonymize',
        description:
          'Verification session records are anonymized after 90 days',
      },
      {
        entity: 'SessionSubmission',
        retentionDays: 90,
        strategy: 'hard_delete',
        description:
          'Session submissions containing PII are hard-deleted after 90 days',
      },
      {
        entity: 'Claim',
        retentionDays: 365,
        strategy: 'soft_delete',
        description: 'Claims are soft-deleted after 1 year',
      },
      {
        entity: 'VerificationRequest',
        retentionDays: 180,
        strategy: 'hard_delete',
        description: 'Verification requests are hard-deleted after 180 days',
      },
    ];

    for (const def of defaults) {
      const existing = await this.prisma.retentionPolicy.findUnique({
        where: { entity: def.entity },
      });
      if (!existing) {
        await this.prisma.retentionPolicy.create({ data: def });
        this.logger.log(`Seeded retention policy for ${def.entity}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Purge execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a single purge run for all enabled policies.
   * Returns a summary of affected records per entity.
   */
  /**
   * Execute a single purge run for all enabled policies.
   * Supports `dryRun` and `batchSize` options.
   */
  async executePurge(opts?: {
    dryRun?: boolean;
    batchSize?: number; // limit per-entity batch size; when provided, operate in chunks
  }): Promise<PurgeResult[]> {
    const { dryRun = false, batchSize } = opts ?? {};

    const policies = await this.prisma.retentionPolicy.findMany({
      where: { enabled: true },
    });

    if (policies.length === 0) {
      this.logger.warn(
        'No enabled retention policies found – nothing to purge',
      );
      return [];
    }

    const results: PurgeResult[] = [];

    for (const policy of policies) {
      try {
        const result = await this.purgeEntity(policy, { dryRun, batchSize });
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Failed to purge ${policy.entity}: ${(error as Error).message}`,
        );
        results.push({
          entity: policy.entity,
          strategy: policy.strategy,
          affected: 0,
          cutoffDate: new Date(),
        });
      }
    }

    return results;
  }

  /**
   * Execute purge for a specific entity/policy.
   */
  async purgeEntity(
    policy: {
      id: string;
      entity: string;
      retentionDays: number;
      strategy: string;
    },
    opts?: { dryRun?: boolean; batchSize?: number },
  ): Promise<PurgeResult> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

    let affected = 0;

    switch (policy.strategy as PurgeStrategy) {
      case 'soft_delete':
        affected = await this.softDelete(policy.entity, cutoffDate, opts);
        break;
      case 'hard_delete':
        affected = await this.hardDelete(policy.entity, cutoffDate, opts);
        break;
      case 'anonymize':
        affected = await this.anonymize(policy.entity, cutoffDate, opts);
        break;
      default:
        this.logger.warn(
          `Unknown purge strategy "${policy.strategy}" for ${policy.entity}`,
        );
    }

    // Produce audit event for the purge
    await this.auditService.record({
      actorId: 'system:retention-purge',
      entity: 'RetentionPolicy',
      entityId: policy.id,
      action: 'purge_executed',
      metadata: {
        targetEntity: policy.entity,
        strategy: policy.strategy,
        retentionDays: policy.retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        affectedRecords: affected,
      },
    });

    this.logger.log(
      `Purged ${affected} ${policy.entity} records (strategy=${policy.strategy}, cutoff=${cutoffDate.toISOString()})`,
    );

    return {
      entity: policy.entity,
      strategy: policy.strategy,
      affected,
      cutoffDate,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy implementations
  // ---------------------------------------------------------------------------

  private async softDelete(
    entity: string,
    cutoffDate: Date,
    opts?: { dryRun?: boolean; batchSize?: number },
  ): Promise<number> {
    const { dryRun = false, batchSize } = opts ?? {};
    const where = {
      createdAt: { lt: cutoffDate },
      deletedAt: null,
    };

    switch (entity) {
      case 'AuditLog': {
        if (dryRun) {
          return await this.prisma.auditLog.count({
            where: { timestamp: { lt: cutoffDate }, deletedAt: null },
          });
        }
        if (!batchSize) {
          const result = await this.prisma.auditLog.updateMany({
            where: { timestamp: { lt: cutoffDate }, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          return result.count;
        }
        // batched updates by id
        let total = 0;
        while (true) {
          const rows = await this.prisma.auditLog.findMany({
            where: { timestamp: { lt: cutoffDate }, deletedAt: null },
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.auditLog.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'VerificationSession': {
        if (dryRun)
          return await this.prisma.verificationSession.count({ where });
        if (!batchSize) {
          const result = await this.prisma.verificationSession.updateMany({
            where,
            data: { deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.verificationSession.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.verificationSession.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'Session': {
        if (dryRun) return await this.prisma.session.count({ where });
        if (!batchSize) {
          const result = await this.prisma.session.updateMany({
            where,
            data: { deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.session.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.session.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'SessionSubmission': {
        if (dryRun) return await this.prisma.sessionSubmission.count({ where });
        if (!batchSize) {
          const result = await this.prisma.sessionSubmission.updateMany({
            where,
            data: { deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.sessionSubmission.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.sessionSubmission.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'Claim': {
        if (dryRun) return await this.prisma.claim.count({ where });
        if (!batchSize) {
          const result = await this.prisma.claim.updateMany({
            where,
            data: { deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.claim.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.claim.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'VerificationRequest': {
        if (dryRun)
          return await this.prisma.verificationRequest.count({ where });
        if (!batchSize) {
          const result = await this.prisma.verificationRequest.updateMany({
            where,
            data: { deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.verificationRequest.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.verificationRequest.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      default:
        this.logger.warn(`soft_delete: Unknown entity "${entity}"`);
        return 0;
    }
  }

  private async hardDelete(
    entity: string,
    cutoffDate: Date,
    opts?: { dryRun?: boolean; batchSize?: number },
  ): Promise<number> {
    const { dryRun = false, batchSize } = opts ?? {};
    const where = {
      createdAt: { lt: cutoffDate },
    };

    switch (entity) {
      case 'AuditLog': {
        if (dryRun)
          return await this.prisma.auditLog.count({
            where: { timestamp: { lt: cutoffDate } },
          });
        if (!batchSize) {
          const result = await this.prisma.auditLog.deleteMany({
            where: { timestamp: { lt: cutoffDate } },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.auditLog.findMany({
            where: { timestamp: { lt: cutoffDate } },
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.auditLog.deleteMany({
            where: { id: { in: ids } },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'VerificationSession': {
        if (dryRun)
          return await this.prisma.verificationSession.count({ where });
        if (!batchSize) {
          const result = await this.prisma.verificationSession.deleteMany({
            where,
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.verificationSession.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.verificationSession.deleteMany({
            where: { id: { in: ids } },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'Session': {
        if (dryRun) return await this.prisma.session.count({ where });
        if (!batchSize) {
          const result = await this.prisma.session.deleteMany({ where });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.session.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.session.deleteMany({
            where: { id: { in: ids } },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'SessionSubmission': {
        if (dryRun) return await this.prisma.sessionSubmission.count({ where });
        if (!batchSize) {
          const result = await this.prisma.sessionSubmission.deleteMany({
            where,
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.sessionSubmission.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.sessionSubmission.deleteMany({
            where: { id: { in: ids } },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'Claim': {
        if (dryRun) return await this.prisma.claim.count({ where });
        if (!batchSize) {
          const result = await this.prisma.claim.deleteMany({ where });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.claim.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.claim.deleteMany({
            where: { id: { in: ids } },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'VerificationRequest': {
        if (dryRun)
          return await this.prisma.verificationRequest.count({ where });
        if (!batchSize) {
          const result = await this.prisma.verificationRequest.deleteMany({
            where,
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.verificationRequest.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.verificationRequest.deleteMany({
            where: { id: { in: ids } },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      default:
        this.logger.warn(`hard_delete: Unknown entity "${entity}"`);
        return 0;
    }
  }

  private async anonymize(
    entity: string,
    cutoffDate: Date,
    opts?: { dryRun?: boolean; batchSize?: number },
  ): Promise<number> {
    const { dryRun = false, batchSize } = opts ?? {};
    const where = {
      createdAt: { lt: cutoffDate },
      deletedAt: null,
    };

    const ANONYMIZED = '[REDACTED]';

    switch (entity) {
      case 'AuditLog': {
        if (dryRun)
          return await this.prisma.auditLog.count({
            where: { timestamp: { lt: cutoffDate }, deletedAt: null },
          });
        if (!batchSize) {
          const result = await this.prisma.auditLog.updateMany({
            where: { timestamp: { lt: cutoffDate }, deletedAt: null },
            data: {
              actorId: ANONYMIZED,
              entityId: ANONYMIZED,
              metadata: {},
              deletedAt: new Date(),
            },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.auditLog.findMany({
            where: { timestamp: { lt: cutoffDate }, deletedAt: null },
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.auditLog.updateMany({
            where: { id: { in: ids } },
            data: {
              actorId: ANONYMIZED,
              entityId: ANONYMIZED,
              metadata: {},
              deletedAt: new Date(),
            },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'VerificationSession': {
        if (dryRun)
          return await this.prisma.verificationSession.count({ where });
        if (!batchSize) {
          const result = await this.prisma.verificationSession.updateMany({
            where,
            data: {
              identifier: ANONYMIZED,
              code: ANONYMIZED,
              deletedAt: new Date(),
            },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.verificationSession.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.verificationSession.updateMany({
            where: { id: { in: ids } },
            data: {
              identifier: ANONYMIZED,
              code: ANONYMIZED,
              deletedAt: new Date(),
            },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'Session': {
        if (dryRun) {
          const cnt = await this.prisma.session.count({ where });
          return cnt;
        }
        if (!batchSize) {
          const result = await this.prisma.session.updateMany({
            where,
            data: { metadata: {}, deletedAt: new Date() },
          });
          // Also anonymize session submissions for this entity
          await this.prisma.sessionSubmission.updateMany({
            where: {
              session: { createdAt: { lt: cutoffDate }, deletedAt: null },
            },
            data: { payload: {}, response: {}, deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.session.findMany({
            where,
            select: { id: true, createdAt: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.session.updateMany({
            where: { id: { in: ids } },
            data: { metadata: {}, deletedAt: new Date() },
          });
          total += res.count;
          // anonymize submissions for these sessions
          await this.prisma.sessionSubmission.updateMany({
            where: { sessionId: { in: ids } },
            data: { payload: {}, response: {}, deletedAt: new Date() },
          });
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'SessionSubmission': {
        if (dryRun) return await this.prisma.sessionSubmission.count({ where });
        if (!batchSize) {
          const result = await this.prisma.sessionSubmission.updateMany({
            where,
            data: { payload: {}, response: {}, deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.sessionSubmission.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.sessionSubmission.updateMany({
            where: { id: { in: ids } },
            data: { payload: {}, response: {}, deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'Claim': {
        if (dryRun) return await this.prisma.claim.count({ where });
        if (!batchSize) {
          const result = await this.prisma.claim.updateMany({
            where,
            data: {
              recipientRef: ANONYMIZED,
              evidenceRef: null,
              deletedAt: new Date(),
            },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.claim.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.claim.updateMany({
            where: { id: { in: ids } },
            data: {
              recipientRef: ANONYMIZED,
              evidenceRef: null,
              deletedAt: new Date(),
            },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      case 'VerificationRequest': {
        if (dryRun)
          return await this.prisma.verificationRequest.count({ where });
        if (!batchSize) {
          const result = await this.prisma.verificationRequest.updateMany({
            where,
            data: { deletedAt: new Date() },
          });
          return result.count;
        }
        let total = 0;
        while (true) {
          const rows = await this.prisma.verificationRequest.findMany({
            where,
            select: { id: true },
            take: batchSize,
          });
          if (rows.length === 0) break;
          const ids = rows.map(r => r.id);
          const res = await this.prisma.verificationRequest.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: new Date() },
          });
          total += res.count;
          if (rows.length < batchSize) break;
        }
        return total;
      }
      default:
        this.logger.warn(`anonymize: Unknown entity "${entity}"`);
        return 0;
    }
  }

  /**
   * Get the list of supported retention entity names.
   */
  getSupportedEntities(): string[] {
    return [...RETENTION_ENTITIES];
  }
}
