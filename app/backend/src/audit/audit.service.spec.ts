import { Test, TestingModule } from '@nestjs/testing';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaService;

  const mockRow = {
    id: 'log-1',
    actorId: 'user-1',
    entity: 'campaign',
    entityId: 'c-1',
    action: 'create',
    orgId: 'org-1',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    metadata: { name: 'test' },
  };

  const mockPrisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: '1' }),
      findMany: jest.fn().mockResolvedValue([mockRow]),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest.fn().mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([mockRow]);
    mockPrisma.auditLog.count.mockResolvedValue(1);
    mockPrisma.$transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('record', () => {
    it('should call prisma.auditLog.create with orgId', async () => {
      const params = {
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
        orgId: 'org-1',
        metadata: { name: 'test' },
      };
      await service.record(params);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'user-1',
          entity: 'campaign',
          entityId: 'c-1',
          action: 'create',
          orgId: 'org-1',
          metadata: { name: 'test' },
        },
      });
    });
  });

  describe('findLogs', () => {
    it('should call prisma.auditLog.findMany', async () => {
      const query = { entity: 'campaign' };
      await service.findLogs(query);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.findMany).toHaveBeenCalled();
    });
  });

  describe('anonymize', () => {
    it('should return a 16-character hex string', () => {
      const hash = service.anonymize('user-1');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should be deterministic', () => {
      expect(service.anonymize('user-1')).toBe(service.anonymize('user-1'));
    });

    it('should produce different hashes for different inputs', () => {
      expect(service.anonymize('user-1')).not.toBe(service.anonymize('user-2'));
    });
  });

  describe('exportLogs', () => {
    it('should return anonymized paginated results', async () => {
      const result = await service.exportLogs({ page: 1, limit: 10 });

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.data).toHaveLength(1);

      const row = result.data[0];
      expect(row.id).toBe('log-1');
      expect(row.actorHash).toBe(service.anonymize('user-1'));
      expect(row.entityHash).toBe(service.anonymize('c-1'));
      expect(row).not.toHaveProperty('actorId');
      expect(row).not.toHaveProperty('entityId');
    });

    it('should use default page=1 and limit=50', async () => {
      await service.exportLogs({});
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should cap limit at 200', async () => {
      const result = await service.exportLogs({ limit: 999 });
      expect(result.limit).toBe(200);
    });

    it('should pass date range filter when provided', async () => {
      await service.exportLogs({ from: '2024-01-01', to: '2024-12-31' });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid from date', async () => {
      await expect(service.exportLogs({ from: 'not-a-date' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for invalid to date', async () => {
      await expect(service.exportLogs({ to: 'not-a-date' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should filter by actorId when provided', async () => {
      await service.exportLogs({ actorId: 'user-1' });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ actorId: 'user-1' }) }),
      );
    });

    it('should filter by action when provided', async () => {
      await service.exportLogs({ action: 'create' });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ action: 'create' }) }),
      );
    });

    it('should filter by orgId from query when provided', async () => {
      await service.exportLogs({ orgId: 'org-1' });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-1' }) }),
      );
    });

    it('should enforce orgId when enforcedOrgId is provided (NGO scoping)', async () => {
      await service.exportLogs({ orgId: 'org-other' }, 'org-enforced');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        // enforcedOrgId takes precedence over query orgId
        expect.objectContaining({ where: expect.objectContaining({ orgId: 'org-enforced' }) }),
      );
    });
  });

  describe('buildCsv', () => {
    it('should include header row', () => {
      const csv = service.buildCsv([]);
      expect(csv).toBe(
        'id,actorHash,entity,entityHash,action,timestamp,metadata',
      );
    });

    it('should use CRLF line endings (RFC 4180)', () => {
      const rows = [
        {
          id: 'log-1',
          actorHash: 'abc123',
          entity: 'campaign',
          entityHash: 'def456',
          action: 'create',
          timestamp: new Date('2024-01-01T00:00:00Z'),
          metadata: {},
        },
      ];
      const csv = service.buildCsv(rows);
      expect(csv).toContain('\r\n');
    });

    it('should quote all fields', () => {
      const rows = [
        {
          id: 'log-1',
          actorHash: 'abc123',
          entity: 'campaign',
          entityHash: 'def456',
          action: 'create',
          timestamp: new Date('2024-01-01T00:00:00Z'),
          metadata: { name: 'test' },
        },
      ];
      const csv = service.buildCsv(rows);
      const dataLine = csv.split('\r\n')[1];
      expect(dataLine).toContain('"log-1"');
      expect(dataLine).toContain('"abc123"');
      expect(dataLine).toContain('"campaign"');
      expect(dataLine).toContain('"2024-01-01T00:00:00.000Z"');
    });

    it('should escape double quotes in field values', () => {
      const rows = [
        {
          id: 'log-1',
          actorHash: 'abc123',
          entity: 'camp"aign',
          entityHash: 'def456',
          action: 'create',
          timestamp: new Date('2024-01-01T00:00:00Z'),
          metadata: {},
        },
      ];
      const csv = service.buildCsv(rows);
      expect(csv).toContain('"camp""aign"');
    });
  });
});
