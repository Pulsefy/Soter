import { Test, TestingModule } from '@nestjs/testing';
import { MockOnchainAdapter } from './onchain.adapter.mock';

describe('MockOnchainAdapter', () => {
  let adapter: MockOnchainAdapter;

  const MOCK_TOKEN_ADDRESS =
    'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

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
        tokenAddress: MOCK_TOKEN_ADDRESS,
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
        tokenAddress: MOCK_TOKEN_ADDRESS,
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
        tokenAddress: MOCK_TOKEN_ADDRESS,
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
        tokenAddress: MOCK_TOKEN_ADDRESS,
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
        tokenAddress: MOCK_TOKEN_ADDRESS,
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
        tokenAddress: MOCK_TOKEN_ADDRESS,
      };

      const result = await adapter.disburse(params);

      expect(result.metadata?.recipientAddress).toBe(recipientAddress);
    });
  });

  describe('partial claims and tranche-based aid packages', () => {
    it('should safely track remaining balance over multiple valid partial claims', async () => {
      const packageId = 'pkg-tranche-123';
      const recipientAddress =
        'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

      // Create a package with 1000 total amount
      await adapter.createAidPackage({
        operatorAddress: 'admin',
        packageId,
        recipientAddress,
        amount: '1000',
        tokenAddress: MOCK_TOKEN_ADDRESS,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      // Retrieve package to check initial state
      let getPkgResult = await adapter.getAidPackage({ packageId });
      expect(getPkgResult.package.remainingAmount).toBe('1000');
      expect(getPkgResult.package.claimedAmount).toBe('0');
      expect(getPkgResult.package.status).toBe('Created');

      // First partial claim of 300
      let claimResult = await adapter.claimAidPackage({
        packageId,
        recipientAddress,
        amount: '300',
      });
      expect(claimResult.status).toBe('success');
      expect(claimResult.amountClaimed).toBe('300');
      expect(claimResult.metadata?.remainingAmount).toBe('700');
      expect(claimResult.metadata?.claimedAmount).toBe('300');
      expect(claimResult.metadata?.status).toBe('Created');

      // Second partial claim of 400
      claimResult = await adapter.claimAidPackage({
        packageId,
        recipientAddress,
        amount: '400',
      });
      expect(claimResult.status).toBe('success');
      expect(claimResult.amountClaimed).toBe('400');
      expect(claimResult.metadata?.remainingAmount).toBe('300');
      expect(claimResult.metadata?.claimedAmount).toBe('700');
      expect(claimResult.metadata?.status).toBe('Created');

      // Final claim of remaining 300
      claimResult = await adapter.claimAidPackage({
        packageId,
        recipientAddress,
        amount: '300',
      });
      expect(claimResult.status).toBe('success');
      expect(claimResult.amountClaimed).toBe('300');
      expect(claimResult.metadata?.remainingAmount).toBe('0');
      expect(claimResult.metadata?.claimedAmount).toBe('1000');
      expect(claimResult.metadata?.status).toBe('Claimed');

      // Check final state of package
      getPkgResult = await adapter.getAidPackage({ packageId });
      expect(getPkgResult.package.status).toBe('Claimed');
      expect(getPkgResult.package.remainingAmount).toBe('0');
    });

    it('should reject claim if amount exceeds remaining balance', async () => {
      const packageId = 'pkg-overclaim-123';
      const recipientAddress =
        'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

      await adapter.createAidPackage({
        operatorAddress: 'admin',
        packageId,
        recipientAddress,
        amount: '500',
        tokenAddress: MOCK_TOKEN_ADDRESS,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      // Claim 600 (exceeds 500)
      await expect(
        adapter.claimAidPackage({
          packageId,
          recipientAddress,
          amount: '601',
        }),
      ).rejects.toThrow('Claim amount exceeds remaining package balance');
    });

    it('should reject claim if package has expired', async () => {
      const packageId = 'pkg-expired-123';
      const recipientAddress =
        'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

      // Create package with an already passed expiration time
      await adapter.createAidPackage({
        operatorAddress: 'admin',
        packageId,
        recipientAddress,
        amount: '500',
        tokenAddress: MOCK_TOKEN_ADDRESS,
        expiresAt: Math.floor(Date.now() / 1000) - 10,
      });

      await expect(
        adapter.claimAidPackage({
          packageId,
          recipientAddress,
          amount: '100',
        }),
      ).rejects.toThrow('Aid package has expired');
    });
  });
});
