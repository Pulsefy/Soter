import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DriftReportService } from './drift-report.service';
import { RedisService } from '../../cache/redis.service';
import { DeploymentMetadataService } from '../deployment-metadata/deployment-metadata.service';
import { ContractReadServiceImpl } from '../onchain/contract-read.service';

describe('DriftReportService', () => {
  let service: DriftReportService;
  let _redis: jest.Mocked<RedisService>;
  let _deploymentMetadata: jest.Mocked<DeploymentMetadataService>;
  let _contractRead: jest.Mocked<ContractReadServiceImpl>;

  const mockDeployment = {
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

  const mockOnChainMetadata = {
    version: '1.0.0',
    name: 'Soroban AidEscrow Contract',
    timestamp: new Date('2026-06-03T12:00:00Z'),
  };

  const mockOnChainPause = {
    isPaused: false,
    timestamp: new Date(),
  };

  const mockOnChainFee = {
    feePercentage: '0',
    maxFee: '0',
    timestamp: new Date(),
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockDeploymentMetadata = {
    findAll: jest.fn(),
  };

  const mockContractRead = {
    getContractMetadata: jest.fn(),
    getPauseState: jest.fn(),
    getFeeConfig: jest.fn(),
    getAidPackageCount: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftReportService,
        { provide: RedisService, useValue: mockRedis },
        {
          provide: DeploymentMetadataService,
          useValue: mockDeploymentMetadata,
        },
        { provide: ContractReadServiceImpl, useValue: mockContractRead },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DriftReportService>(DriftReportService);
    _redis = module.get(RedisService);
    _deploymentMetadata = module.get(DeploymentMetadataService);
    _contractRead = module.get(ContractReadServiceImpl);

    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(undefined);
    mockConfigService.get.mockReturnValue(true);
    mockDeploymentMetadata.findAll.mockResolvedValue([mockDeployment]);
    mockContractRead.getContractMetadata.mockResolvedValue(mockOnChainMetadata);
    mockContractRead.getPauseState.mockResolvedValue(mockOnChainPause);
    mockContractRead.getFeeConfig.mockResolvedValue(mockOnChainFee);
  });

  describe('generateReport', () => {
    it('returns cached report on cache hit', async () => {
      const cachedReport = {
        generatedAt: new Date(),
        configMismatches: [],
        missingDeployments: [],
        networkSummaries: [],
        totalContracts: 1,
        totalNetworks: 1,
        overallStatus: 'healthy',
      };
      mockRedis.get.mockResolvedValue(cachedReport);

      const result = await service.generateReport();

      expect(result).toEqual(cachedReport);
      expect(mockContractRead.getContractMetadata).not.toHaveBeenCalled();
    });

    it('generates fresh report on cache miss', async () => {
      const result = await service.generateReport();

      expect(mockContractRead.getContractMetadata).toHaveBeenCalledTimes(1);
      expect(mockDeploymentMetadata.findAll).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalled();
      expect(result.generatedAt).toBeInstanceOf(Date);
      expect(result.totalContracts).toBe(1);
      expect(result.totalNetworks).toBe(1);
    });

    it('throws when drift reports are disabled', async () => {
      mockConfigService.get.mockReturnValue(false);

      await expect(service.generateReport()).rejects.toThrow(
        'Drift report generation is disabled',
      );
    });

    it('detects config mismatches when wasmHash differs from on-chain version', async () => {
      const mismatchedDeployment = {
        ...mockDeployment,
        wasmHash: 'OLD_HASH_DIFFERENT_FROM_VERSION',
        commitSha: mockOnChainMetadata.version,
      };
      mockDeploymentMetadata.findAll.mockResolvedValue([mismatchedDeployment]);

      const result = await service.generateReport();

      expect(result.configMismatches).toHaveLength(1);
      expect(result.configMismatches[0].field).toBe(
        'wasmHash vs on-chain version',
      );
      expect(result.configMismatches[0].severity).toBe('high');
      expect(result.overallStatus).toBe('critical');
    });

    it('detects low-severity mismatch when commitSha differs from version', async () => {
      const mismatchedDeployment = {
        ...mockDeployment,
        wasmHash: mockOnChainMetadata.version,
        commitSha: 'OLD_COMMIT_SHA',
      };
      const mainnetDeployment = {
        ...mockDeployment,
        id: 'test-id-2',
        network: 'mainnet',
        wasmHash: mockOnChainMetadata.version,
        commitSha: mockOnChainMetadata.version,
      };
      mockDeploymentMetadata.findAll.mockResolvedValue([
        mismatchedDeployment,
        mainnetDeployment,
      ]);

      const result = await service.generateReport();

      expect(result.configMismatches).toHaveLength(1);
      expect(result.configMismatches[0].field).toBe(
        'commitSha vs on-chain version',
      );
      expect(result.configMismatches[0].severity).toBe('low');
      expect(result.overallStatus).toBe('healthy');
    });

    it('detects missing deployments when expected networks have no contracts', async () => {
      mockDeploymentMetadata.findAll.mockResolvedValue([]);

      const result = await service.generateReport();

      expect(result.missingDeployments.length).toBeGreaterThanOrEqual(1);
      expect(result.missingDeployments.some(d => d.network === 'testnet')).toBe(
        true,
      );
      expect(result.overallStatus).not.toBe('healthy');
    });

    it('reports healthy status when no mismatches or missing deployments', async () => {
      const matchingDeployment = {
        ...mockDeployment,
        wasmHash: mockOnChainMetadata.version,
        commitSha: mockOnChainMetadata.version,
      };
      const mainnetDeployment = {
        ...mockDeployment,
        id: 'test-id-2',
        network: 'mainnet',
        wasmHash: mockOnChainMetadata.version,
        commitSha: mockOnChainMetadata.version,
      };
      mockDeploymentMetadata.findAll.mockResolvedValue([
        matchingDeployment,
        mainnetDeployment,
      ]);
      mockContractRead.getAidPackageCount.mockResolvedValue({
        totalCommitted: '0',
        totalClaimed: '0',
        totalExpiredCancelled: '0',
      });

      const result = await service.generateReport();

      expect(result.overallStatus).toBe('healthy');
      expect(result.configMismatches).toHaveLength(0);
    });

    it('continues gracefully when Redis cache set fails', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis down'));

      const result = await service.generateReport();

      expect(result).toBeDefined();
      expect(result.generatedAt).toBeInstanceOf(Date);
    });
  });

  describe('generateHumanReadable', () => {
    it('produces readable text for a healthy report', () => {
      const report = {
        generatedAt: new Date('2026-07-25T10:00:00Z'),
        configMismatches: [],
        missingDeployments: [],
        networkSummaries: [
          {
            network: 'testnet',
            configuredCount: 1,
            onchainVersion: '1.0.0',
            discrepancies: [],
          },
        ],
        totalContracts: 1,
        totalNetworks: 1,
        overallStatus: 'healthy' as const,
      };

      const text = service.generateHumanReadable(report);

      expect(text).toContain('CONTRACT DRIFT REPORT');
      expect(text).toContain('HEALTHY');
      expect(text).toContain('No configuration mismatches detected');
      expect(text).toContain('No missing deployments detected');
      expect(text).toContain('Actionable: NO');
    });

    it('produces readable text for a critical report', () => {
      const report = {
        generatedAt: new Date('2026-07-25T10:00:00Z'),
        configMismatches: [
          {
            contractName: 'AidEscrow',
            network: 'testnet',
            field: 'wasmHash vs on-chain version',
            configured: 'OLD_HASH',
            observed: '1.0.0',
            severity: 'high' as const,
          },
        ],
        missingDeployments: [
          {
            network: 'mainnet',
            contractName: 'AidEscrow',
            severity: 'high' as const,
          },
        ],
        networkSummaries: [],
        totalContracts: 1,
        totalNetworks: 1,
        overallStatus: 'critical' as const,
      };

      const text = service.generateHumanReadable(report);

      expect(text).toContain('CRITICAL');
      expect(text).toContain('Configuration mismatches (1)');
      expect(text).toContain('[HIGH]');
      expect(text).toContain('wasmHash vs on-chain version');
      expect(text).toContain('Missing deployments (1)');
      expect(text).toContain('Actionable: YES');
    });
  });
});
