import { Test, TestingModule } from '@nestjs/testing';
import { AidEscrowService } from '../src/onchain/aid-escrow.service';
import { AidEscrowController } from '../src/onchain/aid-escrow.controller';
import { MockOnchainAdapter } from '../src/onchain/onchain.adapter.mock';
import {
  CreateAidPackageDto,
  BatchCreateAidPackagesDto,
  ClaimAidPackageDto,
} from '../src/onchain/dto/aid-escrow.dto';
import { ONCHAIN_ADAPTER_TOKEN } from '../src/onchain/onchain.adapter';
import { BadRequestException } from '@nestjs/common';

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
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: mockAdapter,
        },
      ],
    }).compile();

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

      const req = {
        user: {
          address: 'GOPER8TORADDRESS00000000000000000000000000000000000000',
        },
      };
      const result = await controller.createAidPackage(dto, req);

      expect(result).toBeDefined();
      expect(result.packageId).toBe(dto.packageId);
      expect(result.status).toBe('success');
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

      const req = {
        user: {
          address: 'GOPER8TORADDRESS00000000000000000000000000000000000000',
        },
      };
      const result = await controller.batchCreateAidPackages(dto, req);

      expect(result).toBeDefined();
      expect(result.packageIds).toHaveLength(2);
      expect(result.status).toBe('success');
    });

    it('should handle POST /packages/:id/claim', async () => {
      const req = {
        user: {
          address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        },
      };
      const result = await controller.claimAidPackage('pkg-001', req);

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
      const req = { user: undefined };

      await expect(controller.claimAidPackage('pkg-001', req)).rejects.toThrow(
        BadRequestException,
      );
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

      const req = {
        user: {
          address: 'GOPER8TORADDRESS00000000000000000000000000000000000000',
        },
      };

      await expect(
        controller.batchCreateAidPackages(dto, req),
      ).rejects.toThrow();
    });
  });
});
