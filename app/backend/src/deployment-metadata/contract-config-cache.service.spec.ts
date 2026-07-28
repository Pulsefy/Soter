import { Test, TestingModule } from '@nestjs/testing';
import { ContractConfigCacheService } from './contract-config-cache.service';
import { RedisService } from '../../cache/redis.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ContractConfigCacheService', () => {
  let service: ContractConfigCacheService;
  let _redis: jest.Mocked<RedisService>;
  let _prisma: jest.Mocked<PrismaService>;

  const record = {
    id: 'id-1',
    contractName: 'AidEscrow',
    network: 'testnet',
    contractId: 'CABC123',
    wasmHash: 'hash-abc',
    deployedAt: new Date('2026-01-01T00:00:00Z'),
    commitSha: 'sha-1',
    deployer: 'GDEPLOY',
    transactionHash: 'tx-hash-1',
    metadata: { version: '1.0' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delByPattern: jest.fn(),
  };

  const mockPrisma = {
    deploymentMetadata: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractConfigCacheService,
        { provide: RedisService, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ContractConfigCacheService>(
      ContractConfigCacheService,
    );
    _redis = module.get(RedisService);
    _prisma = module.get(PrismaService);

    jest.clearAllMocks();
    // Redis set/del always succeeds by default
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(undefined);
    mockRedis.delByPattern.mockResolvedValue(0);
  });

  // ─── getAll ────────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns cached value on cache hit', async () => {
      mockRedis.get.mockResolvedValue([record]);

      const result = await service.getAll();

      expect(result).toEqual([record]);
      expect(mockPrisma.deploymentMetadata.findMany).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('queries DB and populates cache on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([record]);

      const result = await service.getAll();

      expect(mockPrisma.deploymentMetadata.findMany).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'contract-config:all',
        [expect.objectContaining({ id: record.id })],
        expect.any(Number),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(record.id);
    });

    it('returns empty array (and caches it) when DB has no records', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([]);

      const result = await service.getAll();

      expect(result).toEqual([]);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'contract-config:all',
        [],
        expect.any(Number),
      );
    });

    it('falls back to DB silently when Redis returns null (Redis unavailable)', async () => {
      // RedisService.get swallows errors and returns null – simulate that
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([record]);

      const result = await service.getAll();

      expect(result).toHaveLength(1);
    });
  });

  // ─── getByNetwork ──────────────────────────────────────────────────────────

  describe('getByNetwork', () => {
    it('returns cached value on cache hit', async () => {
      mockRedis.get.mockResolvedValue([record]);

      const result = await service.getByNetwork('testnet');

      expect(result).toEqual([record]);
      expect(mockPrisma.deploymentMetadata.findMany).not.toHaveBeenCalled();
    });

    it('queries DB and caches on miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([record]);

      const result = await service.getByNetwork('testnet');

      expect(mockPrisma.deploymentMetadata.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { network: 'testnet' } }),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'contract-config:network:testnet',
        expect.any(Array),
        expect.any(Number),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ─── getByNetworkAndContractName ───────────────────────────────────────────

  describe('getByNetworkAndContractName', () => {
    it('returns cached value on hit', async () => {
      mockRedis.get.mockResolvedValue(record);

      const result = await service.getByNetworkAndContractName(
        'testnet',
        'AidEscrow',
      );

      expect(result).toEqual(record);
      expect(mockPrisma.deploymentMetadata.findUnique).not.toHaveBeenCalled();
    });

    it('queries DB on miss and caches the result', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findUnique.mockResolvedValue(record);

      const result = await service.getByNetworkAndContractName(
        'testnet',
        'AidEscrow',
      );

      expect(mockPrisma.deploymentMetadata.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            network_contractName: {
              network: 'testnet',
              contractName: 'AidEscrow',
            },
          },
        }),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'contract-config:contract:testnet:AidEscrow',
        expect.objectContaining({ id: record.id }),
        expect.any(Number),
      );
      expect(result).not.toBeNull();
    });

    it('caches null and returns null when DB has no match', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findUnique.mockResolvedValue(null);

      const result = await service.getByNetworkAndContractName(
        'testnet',
        'Missing',
      );

      expect(result).toBeNull();
      // null result is cached to prevent repeated DB misses
      expect(mockRedis.set).toHaveBeenCalledWith(
        'contract-config:contract:testnet:Missing',
        null,
        expect.any(Number),
      );
    });
  });

  // ─── getByContractId ───────────────────────────────────────────────────────

  describe('getByContractId', () => {
    it('returns cached value on hit', async () => {
      mockRedis.get.mockResolvedValue(record);

      const result = await service.getByContractId('CABC123');

      expect(result).toEqual(record);
      expect(mockPrisma.deploymentMetadata.findFirst).not.toHaveBeenCalled();
    });

    it('queries DB on miss and caches the result', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findFirst.mockResolvedValue(record);

      const result = await service.getByContractId('CABC123');

      expect(mockPrisma.deploymentMetadata.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { contractId: 'CABC123' } }),
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'contract-config:id:CABC123',
        expect.objectContaining({ id: record.id }),
        expect.any(Number),
      );
      expect(result).not.toBeNull();
    });

    it('returns null when not found in DB', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.deploymentMetadata.findFirst.mockResolvedValue(null);

      const result = await service.getByContractId('NONEXISTENT');

      expect(result).toBeNull();
    });
  });

  // ─── invalidateAll ─────────────────────────────────────────────────────────

  describe('invalidateAll', () => {
    it('deletes all contract-config:* keys via pattern', async () => {
      mockRedis.delByPattern.mockResolvedValue(5);

      const count = await service.invalidateAll();

      expect(mockRedis.delByPattern).toHaveBeenCalledWith('contract-config:*');
      expect(count).toBe(5);
    });

    it('returns 0 when no keys exist', async () => {
      mockRedis.delByPattern.mockResolvedValue(0);

      const count = await service.invalidateAll();

      expect(count).toBe(0);
    });
  });

  // ─── refreshAll ────────────────────────────────────────────────────────────

  describe('refreshAll', () => {
    it('invalidates then re-warms all cache keys and returns stats', async () => {
      mockRedis.delByPattern.mockResolvedValue(3);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([record]);

      const result = await service.refreshAll();

      // Invalidation happened first
      expect(mockRedis.delByPattern).toHaveBeenCalledWith('contract-config:*');

      // All four key types populated: all, byNetwork, byNetworkAndName, byContractId
      const setCalls = mockRedis.set.mock.calls.map(([k]) => k as string);
      expect(setCalls).toContain('contract-config:all');
      expect(setCalls).toContain('contract-config:network:testnet');
      expect(setCalls).toContain('contract-config:contract:testnet:AidEscrow');
      expect(setCalls).toContain('contract-config:id:CABC123');

      // Stats
      expect(result.contractCount).toBe(1);
      expect(result.networkCount).toBe(1);
      expect(result.refreshedAt).toBeInstanceOf(Date);
    });

    it('handles empty DB gracefully – 0 contracts, 0 networks', async () => {
      mockRedis.delByPattern.mockResolvedValue(0);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([]);

      const result = await service.refreshAll();

      expect(result.contractCount).toBe(0);
      expect(result.networkCount).toBe(0);
      // Only the "all" key is written (empty array)
      const setCalls = mockRedis.set.mock.calls.map(([k]) => k as string);
      expect(setCalls).toContain('contract-config:all');
    });

    it('groups multiple contracts by network correctly', async () => {
      const recordB = {
        ...record,
        id: 'id-2',
        contractName: 'TokenVault',
        contractId: 'CDEF456',
        network: 'mainnet',
      };
      mockRedis.delByPattern.mockResolvedValue(0);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([
        record,
        recordB,
      ]);

      const result = await service.refreshAll();

      expect(result.contractCount).toBe(2);
      expect(result.networkCount).toBe(2);

      const setCalls = mockRedis.set.mock.calls.map(([k]) => k as string);
      expect(setCalls).toContain('contract-config:network:testnet');
      expect(setCalls).toContain('contract-config:network:mainnet');
      expect(setCalls).toContain('contract-config:contract:mainnet:TokenVault');
      expect(setCalls).toContain('contract-config:id:CDEF456');
    });
  });

  // ─── safe behavior when Redis is unavailable ───────────────────────────────

  describe('safe fallback when Redis is unavailable', () => {
    it('getAll still returns DB data if Redis.get returns null', async () => {
      mockRedis.get.mockResolvedValue(null);
      // Redis.set silently swallows errors in the real impl – simulate no-op
      mockRedis.set.mockResolvedValue(undefined);
      mockPrisma.deploymentMetadata.findMany.mockResolvedValue([record]);

      const result = await service.getAll();

      expect(result).toHaveLength(1);
    });

    it('getByContractId still returns DB data if Redis.get returns null', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue(undefined);
      mockPrisma.deploymentMetadata.findFirst.mockResolvedValue(record);

      const result = await service.getByContractId('CABC123');

      expect(result).not.toBeNull();
      expect(result!.contractId).toBe('CABC123');
    });
  });
});
