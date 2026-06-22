import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RetentionPolicyService } from './retention-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PurgeStrategyDto } from './dto/create-retention-policy.dto';

describe('RetentionPolicyService', () => {
  let service: RetentionPolicyService;
  let prisma: {
    retentionPolicy: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    auditLog: {
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    verificationSession: {
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    session: {
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    sessionSubmission: {
      updateMany: jest.Mock;
    };
    claim: {
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    verificationRequest: {
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let auditService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      retentionPolicy: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      auditLog: {
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      verificationSession: {
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      session: {
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      sessionSubmission: {
        updateMany: jest.fn(),
      },
      claim: {
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      verificationRequest: {
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    auditService = {
      record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionPolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<RetentionPolicyService>(RetentionPolicyService);
  });

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('should create a new retention policy', async () => {
      const dto = {
        entity: 'AuditLog',
        retentionDays: 90,
        strategy: PurgeStrategyDto.soft_delete,
      };
      prisma.retentionPolicy.findUnique.mockResolvedValue(null);
      prisma.retentionPolicy.create.mockResolvedValue({
        id: 'pol-1',
        ...dto,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create(dto);
      expect(result.id).toBe('pol-1');
      expect(prisma.retentionPolicy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity: 'AuditLog',
          retentionDays: 90,
          strategy: 'soft_delete',
          enabled: true,
        }),
      });
    });

    it('should throw ConflictException if policy already exists', async () => {
      prisma.retentionPolicy.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({ entity: 'AuditLog', retentionDays: 90 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return all policies ordered by entity', async () => {
      const policies = [
        { id: '1', entity: 'AuditLog' },
        { id: '2', entity: 'Session' },
      ];
      prisma.retentionPolicy.findMany.mockResolvedValue(policies);

      const result = await service.findAll();
      expect(result).toEqual(policies);
      expect(prisma.retentionPolicy.findMany).toHaveBeenCalledWith({
        orderBy: { entity: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a policy by id', async () => {
      const policy = { id: 'pol-1', entity: 'AuditLog' };
      prisma.retentionPolicy.findUnique.mockResolvedValue(policy);

      const result = await service.findOne('pol-1');
      expect(result).toEqual(policy);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.retentionPolicy.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a policy', async () => {
      prisma.retentionPolicy.findUnique.mockResolvedValue({ id: 'pol-1' });
      prisma.retentionPolicy.update.mockResolvedValue({
        id: 'pol-1',
        retentionDays: 180,
      });

      const result = await service.update('pol-1', { retentionDays: 180 });
      expect(result.retentionDays).toBe(180);
    });
  });

  describe('remove', () => {
    it('should delete a policy', async () => {
      prisma.retentionPolicy.findUnique.mockResolvedValue({ id: 'pol-1' });
      prisma.retentionPolicy.delete.mockResolvedValue({ id: 'pol-1' });

      const result = await service.remove('pol-1');
      expect(result.id).toBe('pol-1');
    });
  });

  // -------------------------------------------------------------------------
  // Seed defaults
  // -------------------------------------------------------------------------

  describe('seedDefaults', () => {
    it('should create policies that do not exist yet', async () => {
      prisma.retentionPolicy.findUnique.mockResolvedValue(null);
      prisma.retentionPolicy.create.mockResolvedValue({ id: 'new' });

      await service.seedDefaults();
      // 6 entities in defaults
      expect(prisma.retentionPolicy.create).toHaveBeenCalledTimes(6);
    });

    it('should skip policies that already exist', async () => {
      prisma.retentionPolicy.findUnique.mockResolvedValue({ id: 'existing' });

      await service.seedDefaults();
      expect(prisma.retentionPolicy.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Purge execution
  // -------------------------------------------------------------------------

  describe('executePurge', () => {
    it('should return empty array when no policies are enabled', async () => {
      prisma.retentionPolicy.findMany.mockResolvedValue([]);

      const results = await service.executePurge();
      expect(results).toEqual([]);
    });

    it('should purge entities according to their policies', async () => {
      const policies = [
        {
          id: 'pol-1',
          entity: 'AuditLog',
          retentionDays: 90,
          strategy: 'soft_delete',
        },
        {
          id: 'pol-2',
          entity: 'VerificationSession',
          retentionDays: 30,
          strategy: 'hard_delete',
        },
      ];

      prisma.retentionPolicy.findMany.mockResolvedValue(policies);
      prisma.auditLog.updateMany.mockResolvedValue({ count: 5 });
      prisma.verificationSession.deleteMany.mockResolvedValue({ count: 3 });
      auditService.record.mockResolvedValue({ id: 'audit-1' });

      const results = await service.executePurge();

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(
        expect.objectContaining({
          entity: 'AuditLog',
          strategy: 'soft_delete',
          affected: 5,
        }),
      );
      expect(results[1]).toEqual(
        expect.objectContaining({
          entity: 'VerificationSession',
          strategy: 'hard_delete',
          affected: 3,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Purge strategies
  // -------------------------------------------------------------------------

  describe('soft delete strategy', () => {
    it('should soft-delete AuditLog records past retention', async () => {
      const policy = {
        id: 'pol-1',
        entity: 'AuditLog',
        retentionDays: 90,
        strategy: 'soft_delete',
      };

      prisma.auditLog.updateMany.mockResolvedValue({ count: 10 });
      auditService.record.mockResolvedValue({ id: 'audit-1' });

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(10);
      expect(result.strategy).toBe('soft_delete');
      expect(prisma.auditLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });

    it('should soft-delete Claim records past retention', async () => {
      const policy = {
        id: 'pol-2',
        entity: 'Claim',
        retentionDays: 365,
        strategy: 'soft_delete',
      };

      prisma.claim.updateMany.mockResolvedValue({ count: 7 });
      auditService.record.mockResolvedValue({ id: 'audit-2' });

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(7);
      expect(prisma.claim.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('hard delete strategy', () => {
    it('should hard-delete VerificationSession records', async () => {
      const policy = {
        id: 'pol-3',
        entity: 'VerificationSession',
        retentionDays: 180,
        strategy: 'hard_delete',
      };

      prisma.verificationSession.deleteMany.mockResolvedValue({ count: 4 });
      auditService.record.mockResolvedValue({ id: 'audit-3' });

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(4);
      expect(prisma.verificationSession.deleteMany).toHaveBeenCalled();
    });

    it('should hard-delete Session records (cascade)', async () => {
      const policy = {
        id: 'pol-4',
        entity: 'Session',
        retentionDays: 90,
        strategy: 'hard_delete',
      };

      prisma.session.deleteMany.mockResolvedValue({ count: 2 });
      auditService.record.mockResolvedValue({ id: 'audit-4' });

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(2);
    });
  });

  describe('anonymize strategy', () => {
    it('should anonymize AuditLog records', async () => {
      const policy = {
        id: 'pol-5',
        entity: 'AuditLog',
        retentionDays: 90,
        strategy: 'anonymize',
      };

      prisma.auditLog.updateMany.mockResolvedValue({ count: 12 });
      auditService.record.mockResolvedValue({ id: 'audit-5' });

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(12);
      expect(prisma.auditLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: '[REDACTED]',
            entityId: '[REDACTED]',
            metadata: {},
            deletedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should anonymize Session records and submissions', async () => {
      const policy = {
        id: 'pol-6',
        entity: 'Session',
        retentionDays: 90,
        strategy: 'anonymize',
      };

      prisma.session.updateMany.mockResolvedValue({ count: 3 });
      prisma.sessionSubmission.updateMany.mockResolvedValue({ count: 6 });
      auditService.record.mockResolvedValue({ id: 'audit-6' });

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(3);
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: {},
            deletedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.sessionSubmission.updateMany).toHaveBeenCalled();
    });

    it('should anonymize Claim records by redacting PII', async () => {
      const policy = {
        id: 'pol-7',
        entity: 'Claim',
        retentionDays: 365,
        strategy: 'anonymize',
      };

      prisma.claim.updateMany.mockResolvedValue({ count: 8 });
      auditService.record.mockResolvedValue({ id: 'audit-7' });

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(8);
      expect(prisma.claim.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipientRef: '[REDACTED]',
            evidenceRef: null,
            deletedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Audit events on purge
  // -------------------------------------------------------------------------

  describe('audit event on purge', () => {
    it('should record an audit event for each purged entity', async () => {
      const policy = {
        id: 'pol-audit',
        entity: 'AuditLog',
        retentionDays: 90,
        strategy: 'soft_delete',
      };

      prisma.auditLog.updateMany.mockResolvedValue({ count: 15 });
      auditService.record.mockResolvedValue({ id: 'audit-event' });

      await service.purgeEntity(policy);

      expect(auditService.record).toHaveBeenCalledWith({
        actorId: 'system:retention-purge',
        entity: 'RetentionPolicy',
        entityId: 'pol-audit',
        action: 'purge_executed',
        metadata: expect.objectContaining({
          targetEntity: 'AuditLog',
          strategy: 'soft_delete',
          retentionDays: 90,
          affectedRecords: 15,
          cutoffDate: expect.any(String),
        }),
      });
    });
  });

  // -------------------------------------------------------------------------
  // getSupportedEntities
  // -------------------------------------------------------------------------

  describe('getSupportedEntities', () => {
    it('should return list of supported entity names', () => {
      const entities = service.getSupportedEntities();
      expect(entities).toContain('AuditLog');
      expect(entities).toContain('VerificationSession');
      expect(entities).toContain('Session');
      expect(entities).toContain('SessionSubmission');
      expect(entities).toContain('Claim');
      expect(entities).toContain('VerificationRequest');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown entity handling
  // -------------------------------------------------------------------------

  describe('unknown entity', () => {
    it('should return 0 affected for soft_delete on unknown entity', async () => {
      const policy = {
        id: 'pol-unk',
        entity: 'UnknownEntity',
        retentionDays: 90,
        strategy: 'soft_delete',
      };

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(0);
    });

    it('should return 0 affected for hard_delete on unknown entity', async () => {
      const policy = {
        id: 'pol-unk',
        entity: 'UnknownEntity',
        retentionDays: 90,
        strategy: 'hard_delete',
      };

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(0);
    });

    it('should return 0 affected for anonymize on unknown entity', async () => {
      const policy = {
        id: 'pol-unk',
        entity: 'UnknownEntity',
        retentionDays: 90,
        strategy: 'anonymize',
      };

      const result = await service.purgeEntity(policy);
      expect(result.affected).toBe(0);
    });
  });
});
