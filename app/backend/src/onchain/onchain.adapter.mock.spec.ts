import { Test, TestingModule } from '@nestjs/testing';
import { MockOnchainAdapter } from './onchain.adapter.mock';

describe('MockOnchainAdapter', () => {
  let adapter: MockOnchainAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockOnchainAdapter],
    }).compile();

    adapter = module.get<MockOnchainAdapter>(MockOnchainAdapter);
  });

  it('should be defined', () => {
    expect(adapter).toBeDefined();
  });

  describe('initEscrow', () => {
    it('should return a valid InitEscrowResult', async () => {
      const params = {
        adminAddress:
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      };

      const result = await adapter.initEscrow(params);

      expect(result).toHaveProperty('escrowAddress');
      expect(result).toHaveProperty('transactionHash');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('status');
      expect(result.status).toBe('success');
      expect(result.escrowAddress).toBeTruthy();
      expect(result.transactionHash).toHaveLength(64); // SHA256 hex length
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.metadata).toHaveProperty('adminAddress');
      expect(result.metadata?.adapter).toBe('mock');
    });

    it('should return deterministic results for same input', async () => {
      const params = {
        adminAddress:
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      };

      const result1 = await adapter.initEscrow(params);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const result2 = await adapter.initEscrow(params);

      // Escrow address should be the same
      expect(result1.escrowAddress).toBe(result2.escrowAddress);
      // Transaction hashes will differ due to timestamp in hash
      expect(result1.transactionHash).toBeTruthy();
      expect(result2.transactionHash).toBeTruthy();
    });
  });

  describe('createClaim', () => {
    it('should return a valid CreateClaimResult', async () => {
      const params = {
        claimId: 'claim-123',
        recipientAddress:
          'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '1000000000',
        tokenAddress:
          'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      };

      const result = await adapter.createClaim(params);

      expect(result).toHaveProperty('packageId');
      expect(result).toHaveProperty('transactionHash');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('status');
      expect(result.status).toBe('success');
      expect(result.packageId).toBeTruthy();
      expect(result.transactionHash).toHaveLength(64);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.metadata).toHaveProperty('claimId', 'claim-123');
      expect(result.metadata?.adapter).toBe('mock');
    });

    it('should generate deterministic package ID from claim ID', async () => {
      const params = {
        claimId: 'claim-123',
        recipientAddress:
          'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '1000000000',
        tokenAddress:
          'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      };

      const result1 = await adapter.createClaim(params);
      const result2 = await adapter.createClaim(params);

      // Package ID should be deterministic based on claim ID
      expect(result1.packageId).toBe(result2.packageId);
    });

    it('should include expiresAt in metadata when provided', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
      const params = {
        claimId: 'claim-123',
        recipientAddress:
          'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '1000000000',
        tokenAddress:
          'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
        expiresAt,
      };

      const result = await adapter.createClaim(params);

      expect(result.metadata?.expiresAt).toBe(expiresAt);
    });
  });

  describe('disburse', () => {
    it('should return a valid DisburseResult', async () => {
      const params = {
        claimId: 'claim-123',
        packageId: '456',
        recipientAddress:
          'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '1000000000',
      };

      const result = await adapter.disburse(params);

      expect(result).toHaveProperty('transactionHash');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('amountDisbursed');
      expect(result.status).toBe('success');
      expect(result.transactionHash).toHaveLength(64);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.amountDisbursed).toBe('1000000000');
      expect(result.metadata).toHaveProperty('claimId', 'claim-123');
      expect(result.metadata?.packageId).toBe('456');
      expect(result.metadata?.adapter).toBe('mock');
    });

    it('should use default amount when not provided', async () => {
      const params = {
        claimId: 'claim-123',
        packageId: '456',
      };

      const result = await adapter.disburse(params);

      expect(result.amountDisbursed).toBe('1000000000');
    });

    it('should include recipient address in metadata when provided', async () => {
      const recipientAddress =
        'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      const params = {
        claimId: 'claim-123',
        packageId: '456',
        recipientAddress,
      };

      const result = await adapter.disburse(params);

      expect(result.metadata?.recipientAddress).toBe(recipientAddress);
    });
  });

  // ─── Read-Only View Tests ───────────────────────────────────────────────────

  describe('getContractMetadata()', () => {
    it('should return a valid Stellar admin address starting with G', async () => {
      const result = await adapter.getContractMetadata();
      expect(typeof result.admin).toBe('string');
      expect(result.admin.startsWith('G')).toBe(true);
    });

    it('should return version 1 as a number', async () => {
      const result = await adapter.getContractMetadata();
      expect(result.version).toBe(1);
      expect(typeof result.version).toBe('number');
    });

    it('should return a timestamp close to now', async () => {
      const before = Date.now();
      const result = await adapter.getContractMetadata();
      const after = Date.now();
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('getPauseState()', () => {
    it('should return paused: false by default', async () => {
      const result = await adapter.getPauseState();
      expect(result.paused).toBe(false);
    });

    it('should return all per-action flags as false by default', async () => {
      const result = await adapter.getPauseState();
      expect(result.createPaused).toBe(false);
      expect(result.claimPaused).toBe(false);
      expect(result.withdrawPaused).toBe(false);
    });

    it('should return all pause flags as booleans', async () => {
      const result = await adapter.getPauseState();
      expect(typeof result.paused).toBe('boolean');
      expect(typeof result.createPaused).toBe('boolean');
      expect(typeof result.claimPaused).toBe('boolean');
      expect(typeof result.withdrawPaused).toBe('boolean');
    });
  });

  describe('getFeeConfig()', () => {
    it('should return minAmount as string "1"', async () => {
      const result = await adapter.getFeeConfig();
      expect(result.minAmount).toBe('1');
    });

    it('should return maxExpiresIn as 0 (no limit by default)', async () => {
      const result = await adapter.getFeeConfig();
      expect(result.maxExpiresIn).toBe(0);
    });

    it('should return allowedTokens as an empty array by default', async () => {
      const result = await adapter.getFeeConfig();
      expect(Array.isArray(result.allowedTokens)).toBe(true);
      expect(result.allowedTokens.length).toBe(0);
    });
  });

  describe('getPackageSummary()', () => {
    it('should return isExpired: false for an active package (expiresAt in the future)', async () => {
      const result = await adapter.getPackageSummary({ packageId: 'pkg-active-001' });
      // Default mock sets expiresAt = now + 30 days
      expect(result.isExpired).toBe(false);
    });

    it('should return ttlSeconds > 0 for an active package', async () => {
      const result = await adapter.getPackageSummary({ packageId: 'pkg-active-001' });
      expect(result.ttlSeconds).not.toBeNull();
      expect(result.ttlSeconds as number).toBeGreaterThan(0);
    });

    it('should return isExpired: true and ttlSeconds: 0 for an expired package', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      jest.spyOn(adapter, 'getPackageSummary').mockResolvedValueOnce({
        package: {
          id: 'pkg-expired-001',
          recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          amount: '1000000000',
          token: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          status: 'Expired',
          createdAt: pastExpiry - 86400,
          expiresAt: pastExpiry,
        },
        isExpired: true,
        ttlSeconds: 0,
        timestamp: new Date(),
      });

      const result = await adapter.getPackageSummary({ packageId: 'pkg-expired-001' });
      expect(result.isExpired).toBe(true);
      expect(result.ttlSeconds).toBe(0);
    });

    it('should return ttlSeconds: null for a package with no expiry (expiresAt === 0)', async () => {
      jest.spyOn(adapter, 'getPackageSummary').mockResolvedValueOnce({
        package: {
          id: 'pkg-noexpiry-001',
          recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
          amount: '1000000000',
          token: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
          status: 'Created',
          createdAt: Math.floor(Date.now() / 1000),
          expiresAt: 0,
        },
        isExpired: false,
        ttlSeconds: null,
        timestamp: new Date(),
      });

      const result = await adapter.getPackageSummary({ packageId: 'pkg-noexpiry-001' });
      expect(result.isExpired).toBe(false);
      expect(result.ttlSeconds).toBeNull();
    });

    it('should return a package object with all required fields', async () => {
      const result = await adapter.getPackageSummary({ packageId: 'pkg-shape-001' });
      const pkg = result.package;
      expect(pkg).toHaveProperty('id');
      expect(pkg).toHaveProperty('recipient');
      expect(pkg).toHaveProperty('amount');
      expect(pkg).toHaveProperty('token');
      expect(pkg).toHaveProperty('status');
      expect(pkg).toHaveProperty('createdAt');
      expect(pkg).toHaveProperty('expiresAt');
    });

    it('should always include isExpired, ttlSeconds, and timestamp in result', async () => {
      const result = await adapter.getPackageSummary({ packageId: 'pkg-fields-001' });
      expect('isExpired' in result).toBe(true);
      expect('ttlSeconds' in result).toBe(true);
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });
});
