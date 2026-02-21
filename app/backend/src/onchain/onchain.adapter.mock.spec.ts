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
});
