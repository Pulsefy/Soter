import { Test, TestingModule } from '@nestjs/testing';
import { FixtureOnchainAdapter } from './onchain.adapter.fixture';

describe('FixtureOnchainAdapter', () => {
  let adapter: FixtureOnchainAdapter;

  const MOCK_TOKEN_ADDRESS =
    'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FixtureOnchainAdapter],
    }).compile();

    adapter = module.get<FixtureOnchainAdapter>(FixtureOnchainAdapter);
  });

  it('should be defined', () => {
    expect(adapter).toBeDefined();
  });

  describe('getTransactionStatus', () => {
    it('returns succeeded fixture for hash starting with 0-7', async () => {
      const result = await adapter.getTransactionStatus({
        hash: '0ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('succeeded');
      expect(result.ledger).toBe(12345);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.toISOString()).toBe('2024-01-15T12:00:00.000Z');
    });

    it('returns pending fixture for hash starting with 8-B', async () => {
      const result = await adapter.getTransactionStatus({
        hash: 'AABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('pending');
      expect(result.timestamp.toISOString()).toBe('2024-01-15T12:00:00.000Z');
    });

    it('returns failed fixture for hash starting with C-D', async () => {
      const result = await adapter.getTransactionStatus({
        hash: 'CABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('Contract transaction failed');
    });

    it('returns unknown fixture for hash starting with E-F', async () => {
      const result = await adapter.getTransactionStatus({
        hash: 'EABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456ABC123DEF456AB',
      });
      expect(result.status).toBe('unknown');
    });
  });

  describe('getAidPackage', () => {
    it('returns deterministic fixture data', async () => {
      const result = await adapter.getAidPackage({ packageId: 'test-pkg-1' });
      expect(result.package.id).toBe('test-pkg-1');
      expect(result.package.amount).toBe('1000000000');
      expect(result.package.status).toBe('Created');
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('getTokenBalance', () => {
    it('returns deterministic balance', async () => {
      const result = await adapter.getTokenBalance({
        tokenAddress: MOCK_TOKEN_ADDRESS,
        accountAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      });
      expect(result.balance).toBe('10000000000');
      expect(result.tokenAddress).toBe(MOCK_TOKEN_ADDRESS);
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('createAidPackage', () => {
    it('returns success and mirrors input data', async () => {
      const result = await adapter.createAidPackage({
        operatorAddress: 'GOP...',
        packageId: 'pkg-1',
        recipientAddress: 'GREC...',
        amount: '1000',
        tokenAddress: MOCK_TOKEN_ADDRESS,
        expiresAt: 1234567890
      });
      expect(result.status).toBe('success');
      expect(result.packageId).toBe('pkg-1');
      expect(result.metadata?.operatorAddress).toBe('GOP...');
      expect(result.metadata?.expiresAt).toBe(1234567890);
    });
  });
  
  describe('batchCreateAidPackages', () => {
    it('returns fixture merged with parameters', async () => {
      const result = await adapter.batchCreateAidPackages({
        operatorAddress: 'GOP...',
        recipientAddresses: ['R1', 'R2'],
        amounts: ['10', '20'],
        tokenAddress: 'TOK...',
        expiresIn: 3600
      });
      expect(result.status).toBe('success');
      expect(result.packageIds).toHaveLength(2);
      expect(result.metadata?.count).toBe(2);
    });
  });
});
