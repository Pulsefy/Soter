import { AppException } from '../src/common/dto/error-response.dto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AidEscrowService } from '../src/onchain/aid-escrow.service';
import { BudgetService } from '../src/common/budget/budget.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AidEscrowController } from '../src/onchain/aid-escrow.controller';
import { MockOnchainAdapter } from '../src/onchain/onchain.adapter.mock';
import {
  CreateAidPackageDto,
  BatchCreateAidPackagesDto,
  ClaimAidPackageDto,
  ExtendAidPackageExpiryDto,
} from '../src/onchain/dto/aid-escrow.dto';
import { ONCHAIN_ADAPTER_TOKEN } from '../src/onchain/onchain.adapter';
import { SorobanEventCorrelationService } from '../src/onchain/soroban-event-correlation.service';
import { AuditService } from '../src/audit/audit.service';
import { Request } from 'express';

const mockAuditService = {
  record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
};

const mockEventCorrelationService = {
  getCorrelationsForPackage: jest.fn().mockResolvedValue([]),
  getCorrelationsForClaim: jest.fn().mockResolvedValue([]),
  correlateTransaction: jest
    .fn()
    .mockResolvedValue({ correlated: 0, skipped: 0, errors: 0, details: [] }),
  getAllCorrelations: jest
    .fn()
    .mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
};

// Helper to create a mock request object with proper Express Request type
const createMockRequest = (address: string): Partial<Request> => {
  return {
    user: { address },
    get: jest.fn(),
    header: jest.fn(),
    accepts: jest.fn(),
    acceptsCharsets: jest.fn(),
    acceptsEncodings: jest.fn(),
    acceptsLanguages: jest.fn(),
    range: jest.fn(),
    param: jest.fn(),
    is: jest.fn(),
    protocol: 'http',
    secure: false,
    ip: '127.0.0.1',
    ips: [],
    subdomains: [],
    path: '/test',
    hostname: 'localhost',
    fresh: true,
    stale: false,
    xhr: false,
    body: {},
    cookies: {},
    signedCookies: {},
    params: {},
    query: {},
    route: {},
    session: {},
    sessionID: 'test-session',
    method: 'POST',
    url: '/test',
    originalUrl: '/test',
    baseUrl: '',
    headers: {},
    httpVersion: '1.1',
    complete: false,
    aborted: false,
    connection: {},
    socket: {},
  } as unknown as Request; // Cast to Request type to satisfy compiler
};

describe('AidEscrow Integration Tests', () => {
  let service: AidEscrowService;
  let controller: AidEscrowController;
  let mockAdapter: MockOnchainAdapter;

  beforeEach(async () => {
    mockAdapter = new MockOnchainAdapter();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AidEscrowController],
      providers: [
        AidEscrowService,
        BudgetService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: mockAdapter,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('testnet') },
        },
        {
          provide: SorobanEventCorrelationService,
          useValue: mockEventCorrelationService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    mockAuditService.record.mockClear();

    service = module.get<AidEscrowService>(AidEscrowService);
    controller = module.get<AidEscrowController>(AidEscrowController);
  });

  describe('Service: createAidPackage', () => {
    it('should create an aid package', async () => {
      const dto: CreateAidPackageDto = {
        packageId: 'pkg-001',
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '1000000000',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days from now
      };

      const result = await service.createAidPackage(
        dto,
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );

      expect(result).toBeDefined();
      expect(result.packageId).toBe(dto.packageId);
      expect(result.status).toBe('success');
      expect(result.transactionHash).toBeTruthy();
      expect(result.transactionHash).toHaveLength(64);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should include operator address in metadata', async () => {
      const dto: CreateAidPackageDto = {
        packageId: 'pkg-002',
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '500000000',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      };

      const operatorAddress =
        'GOPER8TORADDRESS00000000000000000000000000000000000000';
      const result = await service.createAidPackage(dto, operatorAddress);

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.operatorAddress).toBe(operatorAddress);
    });
  });

  describe('Service: dryRunAidPackageIssuance', () => {
    it('should validate and simulate package issuance without creating a package', async () => {
      const dto: CreateAidPackageDto = {
        packageId: 'pkg-dry-run-001',
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '100',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      };
      const createSpy = jest.spyOn(mockAdapter, 'createAidPackage');

      const result = await service.dryRunAidPackageIssuance(
        dto,
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );

      expect(result.valid).toBe(true);
      expect(result.status).toBe('dry_run');
      expect(result.packageId).toBe(dto.packageId);
      expect(result.validationErrors).toEqual([]);
      expect(result.fees).toMatchObject({
        feePercentage: '0',
        maxFee: '0',
        estimatedFee: '0',
        totalEstimatedDebit: '100',
      });
      expect(result.expectedEvents).toEqual([
        {
          topic: 'package_created',
          payload: {
            package_id: dto.packageId,
            recipient: dto.recipientAddress,
            amount: dto.amount,
            actor: 'GOPER8TORADDRESS00000000000000000000000000000000000000',
            timestamp: '<ledger close time>',
          },
        },
      ]);
      expect(result.metadata.stateChanges).toBe(false);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('should return validation errors instead of submitting invalid issuance', async () => {
      const dto: CreateAidPackageDto = {
        packageId: 'pkg-dry-run-invalid',
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '0',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      };
      const createSpy = jest.spyOn(mockAdapter, 'createAidPackage');

      const result = await service.dryRunAidPackageIssuance(
        dto,
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );

      expect(result.valid).toBe(false);
      expect(result.expectedEvents).toEqual([]);
      expect(result.validationErrors).toContainEqual({
        field: 'amount',
        message: 'Amount must be greater than zero',
      });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('should compute capped fees from fee config', async () => {
      jest.spyOn(mockAdapter, 'getFeeConfig').mockResolvedValue({
        feePercentage: '10',
        maxFee: '5',
        timestamp: new Date(),
      });

      const result = await service.dryRunAidPackageIssuance(
        {
          packageId: 'pkg-dry-run-fee',
          recipientAddress:
            'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          amount: '100',
          tokenAddress:
            'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
        },
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );

      expect(result.fees).toMatchObject({
        feePercentage: '10',
        maxFee: '5',
        estimatedFee: '5',
        totalEstimatedDebit: '105',
      });
    });
  });

  describe('Service: batchCreateAidPackages', () => {
    it('should batch create multiple aid packages', async () => {
      const dto: BatchCreateAidPackagesDto = {
        recipientAddresses: [
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47EL5QRUVLYEK2OOABEXVR5CV7',
        ],
        amounts: ['1000000000', '500000000'],
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresIn: 2592000, // 30 days
      };

      const result = await service.batchCreateAidPackages(
        dto,
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );

      expect(result).toBeDefined();
      expect(result.packageIds).toHaveLength(2);
      expect(result.status).toBe('success');
      expect(result.transactionHash).toBeTruthy();
      expect(result.metadata?.count).toBe(2);
    });

    it('should throw error if arrays have different lengths', async () => {
      const dto: BatchCreateAidPackagesDto = {
        recipientAddresses: [
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47EL5QRUVLYEK2OOABEXVR5CV7',
        ],
        amounts: ['1000000000'], // Only one amount but two recipients
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresIn: 2592000,
      };

      await expect(
        service.batchCreateAidPackages(
          dto,
          'GOPER8TORADDRESS00000000000000000000000000000000000000',
        ),
      ).rejects.toThrow(
        'Recipients and amounts arrays must have the same length',
      );
    });
  });

  describe('Service: claimAidPackage', () => {
    it('should claim an aid package', async () => {
      const dto: ClaimAidPackageDto = {
        packageId: 'pkg-001',
      };

      const recipientAddress =
        'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ';
      const result = await service.claimAidPackage(dto, recipientAddress);

      expect(result).toBeDefined();
      expect(result.packageId).toBe(dto.packageId);
      expect(result.status).toBe('success');
      expect(result.amountClaimed).toBeTruthy();
      expect(result.transactionHash).toHaveLength(64);
    });

    it('should include recipient address in metadata', async () => {
      const dto: ClaimAidPackageDto = {
        packageId: 'pkg-001',
      };

      const recipientAddress =
        'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ';
      const result = await service.claimAidPackage(dto, recipientAddress);

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.recipientAddress).toBe(recipientAddress);
    });
  });

  describe('Service: getAidPackage', () => {
    it('should retrieve aid package details', async () => {
      const result = await service.getAidPackage({ packageId: 'pkg-001' });

      expect(result).toBeDefined();
      expect(result.package).toBeDefined();
      expect(result.package.id).toBe('pkg-001');
      expect(result.package.recipient).toBeTruthy();
      expect(result.package.amount).toBeTruthy();
      expect(result.package.status).toBe('Created');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return valid package structure', async () => {
      const result = await service.getAidPackage({ packageId: 'pkg-001' });

      const pkg = result.package;
      expect(pkg.id).toBeDefined();
      expect(pkg.recipient).toBeDefined();
      expect(pkg.amount).toBeDefined();
      expect(pkg.token).toBeDefined();
      expect(pkg.status).toBeDefined();
      expect(pkg.createdAt).toBeDefined();
      expect(pkg.expiresAt).toBeDefined();
      expect([
        'Created',
        'Claimed',
        'Expired',
        'Cancelled',
        'Refunded',
      ]).toContain(pkg.status);
    });
  });

  describe('Service: getAidPackageStats', () => {
    it('should retrieve aggregated statistics', async () => {
      const result = await service.getAidPackageStats({
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
      });

      expect(result).toBeDefined();
      expect(result.aggregates).toBeDefined();
      expect(result.aggregates.totalCommitted).toBeTruthy();
      expect(result.aggregates.totalClaimed).toBeTruthy();
      expect(result.aggregates.totalExpiredCancelled).toBeTruthy();
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return statistics as strings', async () => {
      const result = await service.getAidPackageStats({
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
      });

      expect(typeof result.aggregates.totalCommitted).toBe('string');
      expect(typeof result.aggregates.totalClaimed).toBe('string');
      expect(typeof result.aggregates.totalExpiredCancelled).toBe('string');
    });
  });

  describe('Service: extendAidPackageExpiry', () => {
    it('should extend expiry of an active package and audit log old and new expiry', async () => {
      const packageId = 'pkg-srv-extend';
      const initialExpiresAt = Math.floor(Date.now() / 1000) + 3600;
      const newExpiresAt = initialExpiresAt + 7200;
      const operatorAddress = 'GOPERATOR123';

      await service.createAidPackage(
        {
          packageId,
          recipientAddress:
            'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          amount: '1000',
          tokenAddress:
            'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          expiresAt: initialExpiresAt,
        },
        operatorAddress,
      );

      const result = await service.extendAidPackageExpiry(
        {
          packageId,
          newExpiresAt,
        },
        operatorAddress,
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('success');
      expect(result.packageId).toBe(packageId);
      expect(result.oldExpiresAt).toBe(initialExpiresAt);
      expect(result.newExpiresAt).toBe(newExpiresAt);
      expect(result.transactionHash).toBeDefined();
      expect(result.explorerUrl).toBeDefined();

      expect(mockAuditService.record).toHaveBeenCalledTimes(1);
      expect(mockAuditService.record).toHaveBeenCalledWith({
        actorId: operatorAddress,
        entity: 'aid_package',
        entityId: packageId,
        action: 'extend_expiry',
        metadata: {
          oldExpiresAt: initialExpiresAt,
          newExpiresAt,
          transactionHash: result.transactionHash,
        },
      });
    });

    it('should reject extension for an already-claimed package', async () => {
      const packageId = 'pkg-srv-claimed';
      const initialExpiresAt = Math.floor(Date.now() / 1000) + 3600;
      const operatorAddress = 'GOPERATOR123';
      const recipientAddress =
        'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ';

      await service.createAidPackage(
        {
          packageId,
          recipientAddress,
          amount: '1000',
          tokenAddress:
            'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          expiresAt: initialExpiresAt,
        },
        operatorAddress,
      );

      await service.claimAidPackage({ packageId }, recipientAddress);

      await expect(
        service.extendAidPackageExpiry(
          {
            packageId,
            newExpiresAt: initialExpiresAt + 7200,
          },
          operatorAddress,
        ),
      ).rejects.toThrow('Aid package is already claimed');
    });
  });

  describe('Controller: REST endpoints', () => {
    it('should handle POST /packages', async () => {
      const dto: CreateAidPackageDto = {
        packageId: 'pkg-001',
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '1000000000',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      };

      const req = createMockRequest(
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );
      const result = await controller.createAidPackage(dto, req as Request);

      expect(result).toBeDefined();
      expect(result.packageId).toBe(dto.packageId);
      expect(result.status).toBe('success');
    });

    it('should handle POST /packages/dry-run', async () => {
      const dto: CreateAidPackageDto = {
        packageId: 'pkg-dry-run-controller',
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '100',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      };

      const req = createMockRequest(
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );
      const result = await controller.dryRunAidPackageIssuance(
        dto,
        req as Request,
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('dry_run');
      expect(result.valid).toBe(true);
      expect(result.metadata.stateChanges).toBe(false);
    });

    it('should handle POST /packages/batch', async () => {
      const dto: BatchCreateAidPackagesDto = {
        recipientAddresses: [
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47EL5QRUVLYEK2OOABEXVR5CV7',
        ],
        amounts: ['1000000000', '500000000'],
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresIn: 2592000,
      };

      const req = createMockRequest(
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );
      const result = await controller.batchCreateAidPackages(
        dto,
        req as Request,
      );

      expect(result).toBeDefined();
      expect(result.packageIds).toHaveLength(2);
      expect(result.status).toBe('success');
    });

    it('should handle POST /packages/:id/claim', async () => {
      const req = createMockRequest(
        'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      );
      const result = await controller.claimAidPackage(
        'pkg-001',
        req as Request,
      );

      expect(result).toBeDefined();
      expect(result.packageId).toBe('pkg-001');
      expect(result.status).toBe('success');
    });

    it('should handle GET /packages/:id', async () => {
      const result = await controller.getAidPackage('pkg-001');

      expect(result).toBeDefined();
      expect(result.package).toBeDefined();
      expect(result.package.id).toBe('pkg-001');
    });

    it('should handle GET /stats', async () => {
      const result = await controller.getAidPackageStats();

      expect(result).toBeDefined();
      expect(result.aggregates).toBeDefined();
      expect(result.aggregates.totalCommitted).toBeTruthy();
    });

    it('should throw error when claiming without recipient address', async () => {
      const req = createMockRequest('');
      req.user = undefined;

      await expect(
        controller.claimAidPackage('pkg-001', req as Request),
      ).rejects.toThrow(AppException);
    });

    it('should handle POST /packages/:id/extend-expiry for authorized operator', async () => {
      const packageId = 'pkg-ctrl-extend';
      const initialExpiresAt = Math.floor(Date.now() / 1000) + 3600;
      const newExpiresAt = initialExpiresAt + 86400;

      await mockAdapter.createAidPackage({
        operatorAddress:
          'GOPER8TORADDRESS00000000000000000000000000000000000000',
        packageId,
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '1000000000',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: initialExpiresAt,
      });

      const req = createMockRequest(
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );
      const dto: ExtendAidPackageExpiryDto = { newExpiresAt };
      const result = await controller.extendAidPackageExpiry(
        packageId,
        dto,
        req as Request,
      );

      expect(result).toBeDefined();
      expect(result.packageId).toBe(packageId);
      expect(result.status).toBe('success');
      expect(result.oldExpiresAt).toBe(initialExpiresAt);
      expect(result.newExpiresAt).toBe(newExpiresAt);
    });

    it('should reject controller POST /packages/:id/extend-expiry for already-claimed package', async () => {
      const packageId = 'pkg-ctrl-claimed';
      const initialExpiresAt = Math.floor(Date.now() / 1000) + 3600;

      await mockAdapter.createAidPackage({
        operatorAddress:
          'GOPER8TORADDRESS00000000000000000000000000000000000000',
        packageId,
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '1000000000',
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresAt: initialExpiresAt,
      });

      await mockAdapter.claimAidPackage({
        packageId,
        recipientAddress:
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      });

      const req = createMockRequest(
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );

      await expect(
        controller.extendAidPackageExpiry(
          packageId,
          { newExpiresAt: initialExpiresAt + 86400 },
          req as Request,
        ),
      ).rejects.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should handle batch create array mismatch', async () => {
      const dto: BatchCreateAidPackagesDto = {
        recipientAddresses: [
          'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        ],
        amounts: ['1000000000', '500000000'], // Mismatch
        tokenAddress:
          'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        expiresIn: 2592000,
      };

      const req = createMockRequest(
        'GOPER8TORADDRESS00000000000000000000000000000000000000',
      );

      await expect(
        controller.batchCreateAidPackages(dto, req as Request),
      ).rejects.toThrow();
    });
  });
});
