import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentMetadataService } from './deployment-metadata.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContractConfigCacheService } from './contract-config-cache.service';

describe('DeploymentMetadataService', () => {
  let service: DeploymentMetadataService;
  let _prisma: jest.Mocked<PrismaService>;
  let _cache: jest.Mocked<ContractConfigCacheService>;

  const mockRecord = {
    id: 'test-id-1',
    contractName: 'AidEscrow',
    network: 'testnet',
    contractId: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
    wasmHash:
      '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
    deployedAt: new Date('2026-06-03T12:00:00Z'),
    commitSha: 'abc123def456',
    deployer: 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY',
    transactionHash:
      '292bf42f063310028456890e88861cd1650149ef0d4e66ba2a22ea5769964e64',
    metadata: { version: '1.0.0' },
    createdAt: new Date('2026-06-03T12:00:00Z'),
    updatedAt: new Date('2026-06-03T12:00:00Z'),
  };

  const mockPrisma = {
    deploymentMetadata: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockCache = {
    getAll: jest.fn(),
    getByNetwork: jest.fn(),
    getByNetworkAndContractName: jest.fn(),
    getByContractId: jest.fn(),
    invalidateAll: jest.fn(),
    refreshAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentMetadataService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContractConfigCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<DeploymentMetadataService>(DeploymentMetadataService);
    _prisma = module.get(PrismaService);
    _cache = module.get(ContractConfigCacheService);

    jest.clearAllMocks();
    // Default: invalidateAll and refreshAll resolve cleanly
    mockCache.invalidateAll.mockResolvedValue(0);
    mockCache.refreshAll.mockResolvedValue({
      refreshedAt: new Date(),
      contractCount: 1,
      networkCount: 1,
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a record and invalidates the cache', async () => {
      mockPrisma.deploymentMetadata.create.mockResolvedValue(mockRecord);

      const dto = {
        contractName: 'AidEscrow',
        network: 'testnet',
        contractId: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
        wasmHash:
          '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
        deployedAt: '2026-06-03T12:00:00Z',
        commitSha: 'abc123def456',
        deployer: 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY',
        transactionHash:
          '292bf42f063310028456890e88861cd1650149ef0d4e66ba2a22ea5769964e64',
      };

      const result = await service.create(dto);

      expect(mockPrisma.deploymentMetadata.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractName: dto.contractName,
            network: dto.network,
            contractId: dto.contractId,
          }),
        }),
      );
      expect(mockCache.invalidateAll).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(mockRecord.id);
    });

    it('propagates Prisma unique-constraint errors without swallowing them', async () => {
      const err = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      mockPrisma.deploymentMetadata.create.mockRejectedValue(err);

      await expect(
        service.create({
          contractName: 'AidEscrow',
          network: 'testnet',
          contractId: 'C123',
          wasmHash: 'abc',
          deployedAt: '2026-06-03T12:00:00Z',
        }),
      ).rejects.toThrow();
    });
  });

  // ─── read helpers (all delegated to cache) ─────────────────────────────────

  describe('findAll', () => {
    it('delegates to ContractConfigCacheService.getAll()', async () => {
      mockCache.getAll.mockResolvedValue([mockRecord]);

      const result = await service.findAll();

      expect(mockCache.getAll).toHaveBeenCalledTimes(1);
      expect(result).toEqual([mockRecord]);
      // Prisma should NOT be called directly
      expect(mockPrisma.deploymentMetadata.findMany).not.toHaveBeenCalled();
    });

    it('returns empty array when cache/DB has no records', async () => {
      mockCache.getAll.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findByNetwork', () => {
    it('delegates to ContractConfigCacheService.getByNetwork()', async () => {
      mockCache.getByNetwork.mockResolvedValue([mockRecord]);

      const result = await service.findByNetwork('testnet');

      expect(mockCache.getByNetwork).toHaveBeenCalledWith('testnet');
      expect(result).toEqual([mockRecord]);
      expect(mockPrisma.deploymentMetadata.findMany).not.toHaveBeenCalled();
    });

    it('returns empty array for unknown network', async () => {
      mockCache.getByNetwork.mockResolvedValue([]);

      const result = await service.findByNetwork('unknown');

      expect(result).toEqual([]);
    });
  });

  describe('findByNetworkAndContractName', () => {
    it('delegates to ContractConfigCacheService.getByNetworkAndContractName()', async () => {
      mockCache.getByNetworkAndContractName.mockResolvedValue(mockRecord);

      const result = await service.findByNetworkAndContractName(
        'testnet',
        'AidEscrow',
      );

      expect(mockCache.getByNetworkAndContractName).toHaveBeenCalledWith(
        'testnet',
        'AidEscrow',
      );
      expect(result).toEqual(mockRecord);
      expect(mockPrisma.deploymentMetadata.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when contract is not found', async () => {
      mockCache.getByNetworkAndContractName.mockResolvedValue(null);

      const result = await service.findByNetworkAndContractName(
        'testnet',
        'NonExistent',
      );

      expect(result).toBeNull();
    });
  });

  describe('findByContractId', () => {
    it('delegates to ContractConfigCacheService.getByContractId()', async () => {
      mockCache.getByContractId.mockResolvedValue(mockRecord);

      const result = await service.findByContractId(
        'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
      );

      expect(mockCache.getByContractId).toHaveBeenCalledWith(
        'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
      );
      expect(result).toEqual(mockRecord);
      expect(mockPrisma.deploymentMetadata.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when contract ID is not found', async () => {
      mockCache.getByContractId.mockResolvedValue(null);

      const result = await service.findByContractId('NONEXISTENT');

      expect(result).toBeNull();
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates the record and invalidates the cache', async () => {
      const updated = { ...mockRecord, commitSha: 'new-sha-123' };
      mockPrisma.deploymentMetadata.update.mockResolvedValue(updated);

      const result = await service.update('test-id-1', {
        commitSha: 'new-sha-123',
      });

      expect(mockPrisma.deploymentMetadata.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'test-id-1' } }),
      );
      expect(mockCache.invalidateAll).toHaveBeenCalledTimes(1);
      expect(result.commitSha).toBe('new-sha-123');
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the record and invalidates the cache', async () => {
      mockPrisma.deploymentMetadata.delete.mockResolvedValue(mockRecord);

      await service.delete('test-id-1');

      expect(mockPrisma.deploymentMetadata.delete).toHaveBeenCalledWith({
        where: { id: 'test-id-1' },
      });
      expect(mockCache.invalidateAll).toHaveBeenCalledTimes(1);
    });
  });

  // ─── refreshCache ──────────────────────────────────────────────────────────

  describe('refreshCache', () => {
    it('delegates to ContractConfigCacheService.refreshAll() and returns stats', async () => {
      const stats = {
        refreshedAt: new Date('2026-06-03T12:00:00Z'),
        contractCount: 3,
        networkCount: 2,
      };
      mockCache.refreshAll.mockResolvedValue(stats);

      const result = await service.refreshCache();

      expect(mockCache.refreshAll).toHaveBeenCalledTimes(1);
      expect(result).toEqual(stats);
    });
  });

  // ─── network isolation ─────────────────────────────────────────────────────

  describe('network isolation', () => {
    it('returns only testnet records when querying testnet', async () => {
      const testnetRecord = { ...mockRecord, network: 'testnet' };
      mockCache.getByNetwork.mockResolvedValue([testnetRecord]);

      const result = await service.findByNetwork('testnet');

      expect(result).toEqual([testnetRecord]);
      expect(result.every(r => r.network === 'testnet')).toBe(true);
    });

    it('returns only mainnet records when querying mainnet', async () => {
      const mainnetRecord = { ...mockRecord, network: 'mainnet' };
      mockCache.getByNetwork.mockResolvedValue([mainnetRecord]);

      const result = await service.findByNetwork('mainnet');

      expect(result).toEqual([mainnetRecord]);
      expect(result.every(r => r.network === 'mainnet')).toBe(true);
    });
  });
});
