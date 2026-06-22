import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentMetadataService } from './deployment-metadata.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DeploymentMetadataService', () => {
  let service: DeploymentMetadataService;
  let prisma: PrismaService;

  const mockDeploymentMetadata = {
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

  const mockPrismaService = {
    deploymentMetadata: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentMetadataService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DeploymentMetadataService>(DeploymentMetadataService);
    prisma = module.get<PrismaService>(PrismaService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new deployment metadata', async () => {
      mockPrismaService.deploymentMetadata.create.mockResolvedValue(
        mockDeploymentMetadata,
      );

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

      expect(result).toEqual(mockDeploymentMetadata);
      expect(prisma.deploymentMetadata.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contractName: dto.contractName,
          network: dto.network,
          contractId: dto.contractId,
        }),
      });
    });
  });

  describe('findAll', () => {
    it('should return all deployment metadata', async () => {
      mockPrismaService.deploymentMetadata.findMany.mockResolvedValue([
        mockDeploymentMetadata,
      ]);

      const result = await service.findAll();

      expect(result).toEqual([mockDeploymentMetadata]);
      expect(prisma.deploymentMetadata.findMany).toHaveBeenCalledWith({
        orderBy: { deployedAt: 'desc' },
      });
    });

    it('should return empty array when no metadata exists', async () => {
      mockPrismaService.deploymentMetadata.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findByNetwork', () => {
    it('should return metadata for a specific network', async () => {
      mockPrismaService.deploymentMetadata.findMany.mockResolvedValue([
        mockDeploymentMetadata,
      ]);

      const result = await service.findByNetwork('testnet');

      expect(result).toEqual([mockDeploymentMetadata]);
      expect(prisma.deploymentMetadata.findMany).toHaveBeenCalledWith({
        where: { network: 'testnet' },
        orderBy: { deployedAt: 'desc' },
      });
    });

    it('should return empty array for network with no deployments', async () => {
      mockPrismaService.deploymentMetadata.findMany.mockResolvedValue([]);

      const result = await service.findByNetwork('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('findByNetworkAndContractName', () => {
    it('should return metadata for a specific network and contract name', async () => {
      mockPrismaService.deploymentMetadata.findUnique.mockResolvedValue(
        mockDeploymentMetadata,
      );

      const result = await service.findByNetworkAndContractName(
        'testnet',
        'AidEscrow',
      );

      expect(result).toEqual(mockDeploymentMetadata);
      expect(prisma.deploymentMetadata.findUnique).toHaveBeenCalledWith({
        where: {
          network_contractName: {
            network: 'testnet',
            contractName: 'AidEscrow',
          },
        },
      });
    });

    it('should return null if metadata not found', async () => {
      mockPrismaService.deploymentMetadata.findUnique.mockResolvedValue(null);

      const result = await service.findByNetworkAndContractName(
        'testnet',
        'NonExistent',
      );

      expect(result).toBeNull();
    });
  });

  describe('findByContractId', () => {
    it('should return metadata for a specific contract ID', async () => {
      mockPrismaService.deploymentMetadata.findFirst.mockResolvedValue(
        mockDeploymentMetadata,
      );

      const result = await service.findByContractId(
        'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
      );

      expect(result).toEqual(mockDeploymentMetadata);
      expect(prisma.deploymentMetadata.findFirst).toHaveBeenCalledWith({
        where: {
          contractId:
            'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
        },
      });
    });

    it('should return null if contract ID not found', async () => {
      mockPrismaService.deploymentMetadata.findFirst.mockResolvedValue(null);

      const result = await service.findByContractId('NONEXISTENT');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update deployment metadata', async () => {
      const updated = { ...mockDeploymentMetadata, commitSha: 'new-sha-123' };
      mockPrismaService.deploymentMetadata.update.mockResolvedValue(updated);

      const dto = { commitSha: 'new-sha-123' };
      const result = await service.update('test-id-1', dto);

      expect(result).toEqual(updated);
      expect(prisma.deploymentMetadata.update).toHaveBeenCalledWith({
        where: { id: 'test-id-1' },
        data: expect.objectContaining(dto),
      });
    });
  });

  describe('delete', () => {
    it('should delete deployment metadata', async () => {
      mockPrismaService.deploymentMetadata.delete.mockResolvedValue(
        mockDeploymentMetadata,
      );

      await service.delete('test-id-1');

      expect(prisma.deploymentMetadata.delete).toHaveBeenCalledWith({
        where: { id: 'test-id-1' },
      });
    });
  });

  describe('tenant safety', () => {
    it('should isolate deployment metadata per network', async () => {
      const testnetMetadata = { ...mockDeploymentMetadata, network: 'testnet' };
      const mainnetMetadata = { ...mockDeploymentMetadata, network: 'mainnet' };

      mockPrismaService.deploymentMetadata.findMany
        .mockResolvedValueOnce([testnetMetadata])
        .mockResolvedValueOnce([mainnetMetadata]);

      const testnetResult = await service.findByNetwork('testnet');
      const mainnetResult = await service.findByNetwork('mainnet');

      expect(testnetResult).toEqual([testnetMetadata]);
      expect(mainnetResult).toEqual([mainnetMetadata]);
      expect(prisma.deploymentMetadata.findMany).toHaveBeenCalledTimes(2);
    });

    it('should enforce unique constraint on network and contractName', async () => {
      const error = new Error('Unique constraint failed');
      (error as any).code = 'P2002';
      mockPrismaService.deploymentMetadata.create.mockRejectedValueOnce(error);

      const dto = {
        contractName: 'AidEscrow',
        network: 'testnet',
        contractId: 'CDSBJ27PKTNFTRW6OKPCVXDRUSSRUIQUG6DW5PUTKLDXTDT23NQIS6JG',
        wasmHash:
          '24328e15b7c11c7ff07caeaf0328da591b3b63e84af57fa03623c10126eabc8d',
        deployedAt: '2026-06-03T12:00:00Z',
      };

      await expect(service.create(dto)).rejects.toThrow();
    });
  });
});
