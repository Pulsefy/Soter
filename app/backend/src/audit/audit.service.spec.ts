import { AppException } from '../common/dto/error-response.dto';
import { Test, TestingModule } from '@nestjs/testing';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_MAX_PAGE_SIZE,
  AuditQuery,
  AuditService,
} from './audit.service';
import { AuditChainService } from './audit-chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaService;

  const mockRow = {
    id: 'log-1',
    actorId: 'user-1',
    entity: 'campaign',
    entityId: 'c-1',
    action: 'create',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    metadata: { name: 'test' },
  };

  const mockPrisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: '1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn().mockResolvedValue([[mockRow], 1]),
  };

  const mockMetricsService = {
    dbQueryDuration: {
      startTimer: jest.fn(() => jest.fn()),
    },
    dbErrorsTotal: {
      inc: jest.fn(),
    },
  };

  const mockAuditChainService = {
    appendToChain: jest.fn().mockResolvedValue({
      id: 'log-1',
      sequence: '1',
      prevHash: '0'.repeat(64),
      entryHash: 'a'.repeat(64),
      metadataCanonical: '{}',
    }),
    verifyChain: jest.fn(),
    backfillChain: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: AuditChainService,
          useValue: mockAuditChainService,
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('record', () => {
    it('should delegate to the hash-chain append path', async () => {
      const params = {
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
        metadata: { name: 'test' },
      };
      await service.record(params);

      expect(mockAuditChainService.appendToChain).toHaveBeenCalledWith(params);
    });

    it('should return the chained entry', async () => {
      const result = await service.record({
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
      });

      expect(result).toEqual({
        id: 'log-1',
        sequence: '1',
        prevHash: '0'.repeat(64),
        entryHash: 'a'.repeat(64),
        metadataCanonical: '{}',
      });
    });

    it('should propagate chain append failures', async () => {
      mockAuditChainService.appendToChain.mockRejectedValueOnce(
        new Error('chain locked'),
      );

      await expect(
        service.record({
          actorId: 'user-1',
          entity: 'campaign',
          entityId: 'c-1',
          action: 'create',
        }),
      ).rejects.toThrow('chain locked');
      expect(mockMetricsService.dbErrorsTotal.inc).toHaveBeenCalledWith({
        operation: 'create',
        entity: 'AuditLog',
      });
    });
  });

  describe('findLogs', () => {
    it('should call prisma.auditLog.findMany', async () => {
      const query = { entity: 'campaign' };
      await service.findLogs(query);

      expect(prisma.auditLog.findMany).toHaveBeenCalled();
    });
  });

  describe('findLogs pagination over a large result set', () => {
    const TOTAL = 1000;
    // 10 rows share each timestamp, so ordering needs the id tiebreaker.
    const allRows = Array.from({ length: TOTAL }, (_, i) => ({
      ...mockRow,
      id: `log-${String(i).padStart(4, '0')}`,
      timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, Math.floor(i / 10))),
    }));
    const newestFirst = [...allRows].sort(
      (a, b) =>
        b.timestamp.getTime() - a.timestamp.getTime() || (a.id < b.id ? 1 : -1),
    );

    beforeEach(() => {
      mockPrisma.auditLog.findMany.mockImplementation(
        ({ skip = 0, take }: { skip?: number; take: number }) =>
          Promise.resolve(newestFirst.slice(skip, skip + take)),
      );
      mockPrisma.auditLog.count.mockResolvedValue(TOTAL);
      mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
        Promise.all(ops),
      );
    });

    afterEach(() => {
      mockPrisma.auditLog.findMany.mockReset().mockResolvedValue([]);
      mockPrisma.auditLog.count.mockReset().mockResolvedValue(0);
      mockPrisma.$transaction.mockReset().mockResolvedValue([[mockRow], 1]);
    });

    it('returns every row exactly once across multiple requests', async () => {
      const seen: string[] = [];
      let pages = 0;
      for (let page = 1; ; page++) {
        const result = await service.findLogs({ page, limit: 200 });
        if (result.data.length === 0) break;
        pages += 1;
        expect(result.page).toBe(page);
        expect(result.total).toBe(TOTAL);
        expect(result.totalPages).toBe(5);
        seen.push(...result.data.map(r => r.id));
      }

      expect(pages).toBe(5);
      expect(seen).toHaveLength(TOTAL);
      expect(new Set(seen).size).toBe(TOTAL);
      expect(seen).toEqual(newestFirst.map(r => r.id));
    });

    it('applies the documented default page size', async () => {
      const result = await service.findLogs({});

      expect(result.limit).toBe(AUDIT_DEFAULT_PAGE_SIZE);
      expect(result.page).toBe(1);
      expect(result.data).toHaveLength(50);
      expect(result.totalPages).toBe(20);
    });

    it('clamps limit to the maximum page size', async () => {
      const result = await service.findLogs({ limit: 5000 });

      expect(result.limit).toBe(AUDIT_MAX_PAGE_SIZE);
      expect(result.data).toHaveLength(AUDIT_MAX_PAGE_SIZE);
    });

    it('falls back to defaults for unusable page/limit values', async () => {
      const result = await service.findLogs({
        page: 'abc' as unknown as number,
        limit: 'xyz' as unknown as number,
      });

      expect(result.page).toBe(1);
      expect(result.limit).toBe(AUDIT_DEFAULT_PAGE_SIZE);
    });

    it('orders by timestamp then id so pages are stable across ties', async () => {
      await service.findLogs({ page: 2, limit: 10 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('AuditQuery validation', () => {
    const check = (input: Record<string, unknown>) =>
      validate(plainToInstance(AuditQuery, input), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('accepts string page/limit coming from a query string', async () => {
      expect(await check({ page: '2', limit: '50', entity: 'claim' })).toEqual(
        [],
      );
    });

    it.each([
      ['page=0', { page: '0' }],
      ['page=abc', { page: 'abc' }],
      ['limit=0', { limit: '0' }],
      ['limit=1.5', { limit: '1.5' }],
      ['an invalid startTime', { startTime: 'yesterday' }],
    ])('rejects %s', async (_label, input) => {
      expect((await check(input)).length).toBeGreaterThan(0);
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

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should cap limit at 200', async () => {
      const result = await service.exportLogs({ limit: 999 });
      expect(result.limit).toBe(200);
    });

    it('should pass date range filter when provided', async () => {
      await service.exportLogs({ from: '2024-01-01', to: '2024-12-31' });

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid from date', async () => {
      await expect(service.exportLogs({ from: 'not-a-date' })).rejects.toThrow(
        AppException,
      );
    });

    it('should throw BadRequestException for invalid to date', async () => {
      await expect(service.exportLogs({ to: 'not-a-date' })).rejects.toThrow(
        AppException,
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
