import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SorobanOnchainAdapter } from './soroban-onchain.adapter';
import * as StellarSdk from '@stellar/stellar-sdk';

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn(),
        simulateTransaction: jest.fn(),
        sendTransaction: jest.fn(),
        getTransaction: jest.fn(),
      })),
      Api: {
        ...actual.SorobanRpc.Api,
        assembleTransaction: jest.fn(),
      },
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(),
    })),
    Keypair: {
      fromSecret: jest.fn().mockImplementation(secret => ({
        publicKey: jest
          .fn()
          .mockReturnValue(
            'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          ),
        secret: secret,
      })),
    },
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
      FUTURENET: 'Soroban Futurenet ; October 2022',
    },
    BASE_FEE: 100,
    StrKey: {
      encodeBuffer: jest.fn().mockImplementation(buf => buf.toString('hex')),
    },
  };
});

describe('SorobanOnchainAdapter', () => {
  let adapter: SorobanOnchainAdapter;
  let _configService: ConfigService;
  let mockServer: any;

  const mockConfig = {
    STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
    STELLAR_NETWORK: 'testnet',
    SOROBAN_CONTRACT_ID:
      'CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    STELLAR_SECRET_KEY:
      'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanOnchainAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              return mockConfig[key as keyof typeof mockConfig] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    adapter = module.get<SorobanOnchainAdapter>(SorobanOnchainAdapter);
    configService = module.get<ConfigService>(ConfigService);
    mockServer = (adapter as any).server;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(adapter).toBeDefined();
  });

  describe('constructor', () => {
    it('should throw error if SOROBAN_CONTRACT_ID is not set', () => {
      const badConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'SOROBAN_CONTRACT_ID') return undefined;
          return mockConfig[key as keyof typeof mockConfig];
        }),
      };

      expect(() => new SorobanOnchainAdapter(badConfigService as any)).toThrow(
        'SOROBAN_CONTRACT_ID is required',
      );
    });

    it('should throw error if STELLAR_SECRET_KEY is not set', () => {
      const badConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'STELLAR_SECRET_KEY') return undefined;
          return mockConfig[key as keyof typeof mockConfig];
        }),
      };

      expect(() => new SorobanOnchainAdapter(badConfigService as any)).toThrow(
        'STELLAR_SECRET_KEY is required',
      );
    });

    it('should initialize with correct network passphrase for testnet', () => {
      const configServiceTestnet = {
        get: jest.fn((key: string) => {
          if (key === 'STELLAR_NETWORK') return 'testnet';
          return mockConfig[key as keyof typeof mockConfig];
        }),
      };

      const testnetAdapter = new SorobanOnchainAdapter(
        configServiceTestnet as any,
      );
      expect((testnetAdapter as any).networkPassphrase).toBe(
        StellarSdk.Networks.TESTNET,
      );
    });

    it('should initialize with correct network passphrase for mainnet', () => {
      const configServiceMainnet = {
        get: jest.fn((key: string) => {
          if (key === 'STELLAR_NETWORK') return 'mainnet';
          return mockConfig[key as keyof typeof mockConfig];
        }),
      };

      const mainnetAdapter = new SorobanOnchainAdapter(
        configServiceMainnet as any,
      );
      expect((mainnetAdapter as any).networkPassphrase).toBe(
        StellarSdk.Networks.PUBLIC,
      );
    });
  });

  describe('initEscrow', () => {
    const mockParams = {
      adminAddress: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    };

    beforeEach(() => {
      mockServer.getAccount.mockResolvedValue({
        accountId: mockParams.adminAddress,
        sequence: '123456789',
      });

      // Mock simulation response with result property (not error)
      mockServer.simulateTransaction.mockResolvedValue({
        result: {
          status: 'success',
        },
        transactionData: {
          resourceFee: BigInt(100),
          instructions: [],
          readBytes: 100,
          writeBytes: 100,
        },
        auth: [],
        returnValue: {},
        stateChanges: [],
        minResourceFee: BigInt(50),
        cost: { cpuInsns: '1000', memBytes: '1000' },
      });

      mockServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx_hash_123456',
      });

      mockServer.getTransaction.mockResolvedValue({
        status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: { value: () => 'success' },
      });
    });

    it('should successfully initialize escrow', async () => {
      const result = await adapter.initEscrow(mockParams);

      expect(result.status).toBe('success');
      expect(result.escrowAddress).toBe(mockConfig.SOROBAN_CONTRACT_ID);
      expect(result.transactionHash).toBe('tx_hash_123456');
      expect(result.metadata?.adminAddress).toBe(mockParams.adminAddress);
      expect(result.metadata?.adapter).toBe('soroban');
    });

    it('should handle simulation failure', async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        error: 'Simulation failed',
      });

      const result = await adapter.initEscrow(mockParams);

      expect(result.status).toBe('failed');
      expect(result.transactionHash).toBe('');
      expect(result.metadata?.error).toContain('Simulation failed');
    });

    it('should handle transaction submission failure', async () => {
      mockServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        error: { result: 'Submission failed' },
      });

      const result = await adapter.initEscrow(mockParams);

      expect(result.status).toBe('failed');
      expect(result.transactionHash).toBe('');
    });

    it('should handle transaction polling timeout', async () => {
      mockServer.getTransaction.mockResolvedValue({
        status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
      });

      const result = await adapter.initEscrow(mockParams);

      expect(result.status).toBe('failed');
    });
  });

  describe('createClaim', () => {
    const mockParams = {
      claimId: 'claim-123',
      recipientAddress: 'GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      amount: '1000000000', // 1000 XLM in stroops
      tokenAddress: 'CTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      expiresAt: 1234567890,
    };

    beforeEach(() => {
      mockServer.getAccount.mockResolvedValue({
        accountId: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        sequence: '123456789',
      });

      // Mock simulation response with result property (not error)
      mockServer.simulateTransaction.mockResolvedValue({
        result: {
          status: 'success',
        },
        transactionData: {
          resourceFee: BigInt(100),
          instructions: [],
          readBytes: 100,
          writeBytes: 100,
        },
        auth: [],
        returnValue: {},
        stateChanges: [],
        minResourceFee: BigInt(50),
        cost: { cpuInsns: '1000', memBytes: '1000' },
      });

      mockServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx_hash_create_claim',
      });

      mockServer.getTransaction.mockResolvedValue({
        status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: { value: () => 'pkg_123' },
      });
    });

    it('should successfully create a claim', async () => {
      const result = await adapter.createClaim(mockParams);

      expect(result.status).toBe('success');
      expect(result.packageId).toBe('pkg_123');
      expect(result.transactionHash).toBe('tx_hash_create_claim');
      expect(result.metadata?.claimId).toBe(mockParams.claimId);
      expect(result.metadata?.recipientAddress).toBe(
        mockParams.recipientAddress,
      );
      expect(result.metadata?.amount).toBe(mockParams.amount);
    });

    it('should handle missing expiresAt parameter', async () => {
      const paramsWithoutExpiry = { ...mockParams, expiresAt: undefined };
      const result = await adapter.createClaim(paramsWithoutExpiry);

      expect(result.status).toBe('success');
      expect(result.packageId).toBe('pkg_123');
    });

    it('should handle simulation failure', async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        error: 'Simulation error',
      });

      const result = await adapter.createClaim(mockParams);

      expect(result.status).toBe('failed');
      expect(result.packageId).toBe('');
    });

    it('should extract package ID from result', async () => {
      mockServer.getTransaction.mockResolvedValue({
        status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: { value: () => 'pkg_456' },
      });

      const result = await adapter.createClaim(mockParams);

      expect(result.packageId).toBe('pkg_456');
    });
  });

  describe('disburse', () => {
    const mockParams = {
      claimId: 'claim-123',
      packageId: 'pkg_123',
      recipientAddress: 'GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      amount: '1000000000',
    };

    beforeEach(() => {
      mockServer.getAccount.mockResolvedValue({
        accountId: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        sequence: '123456789',
      });

      // Mock simulation response with result property (not error)
      mockServer.simulateTransaction.mockResolvedValue({
        result: {
          status: 'success',
        },
        transactionData: {
          resourceFee: BigInt(100),
          instructions: [],
          readBytes: 100,
          writeBytes: 100,
        },
        auth: [],
        returnValue: {},
        stateChanges: [],
        minResourceFee: BigInt(50),
        cost: { cpuInsns: '1000', memBytes: '1000' },
      });

      mockServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx_hash_disburse',
      });

      mockServer.getTransaction.mockResolvedValue({
        status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: { value: () => '1000000000' },
      });
    });

    it('should successfully disburse funds', async () => {
      const result = await adapter.disburse(mockParams);

      expect(result.status).toBe('success');
      expect(result.transactionHash).toBe('tx_hash_disburse');
      expect(result.amountDisbursed).toBe('1000000000');
      expect(result.metadata?.claimId).toBe(mockParams.claimId);
      expect(result.metadata?.packageId).toBe(mockParams.packageId);
    });

    it('should handle simulation failure', async () => {
      mockServer.simulateTransaction.mockResolvedValue({
        error: 'Simulation failed',
      });

      const result = await adapter.disburse(mockParams);

      expect(result.status).toBe('failed');
      expect(result.transactionHash).toBe('');
      expect(result.amountDisbursed).toBe('0');
    });

    it('should handle missing amount parameter', async () => {
      const paramsWithoutAmount = { ...mockParams, amount: undefined };

      // The disburse method should handle undefined amount gracefully
      // by using '0' as default
      const result = await adapter.disburse(paramsWithoutAmount);

      // Since packageId is "pkg_123" (not numeric), it will fail BigInt conversion
      // and be handled gracefully
      expect(result.status).toBe('failed');
      expect(result.transactionHash).toBe('');
      expect(result.amountDisbursed).toBe('0');
    });
  });

  describe('pollTransaction', () => {
    it('should poll until transaction is confirmed', async () => {
      let attempts = 0;
      mockServer.getTransaction.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve({
            status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
          });
        }
        return Promise.resolve({
          status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS,
          returnValue: { value: () => 'success' },
        });
      });

      const result = await (adapter as any).pollTransaction('tx_hash');
      expect(result.status).toBe(
        StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      );
      expect(attempts).toBe(3);
    });

    it('should throw error after max attempts', async () => {
      mockServer.getTransaction.mockResolvedValue({
        status: StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
      });

      await expect(
        (adapter as any).pollTransaction('tx_hash', 5, 100),
      ).rejects.toThrow('not confirmed after 5 attempts');
    });
  });

  describe('extractPackageId', () => {
    it('should extract package ID from return value', () => {
      const txResult = {
        returnValue: {
          value: () => 'pkg_789',
        },
      };

      const result = (adapter as any).extractPackageId(txResult, 'claim-123');
      expect(result).toBe('pkg_789');
    });

    it('should fallback to claim ID if no return value', () => {
      const txResult = {};
      const result = (adapter as any).extractPackageId(txResult, 'claim-456');
      expect(result).toContain('pkg_');
    });
  });

  describe('extractAmountFromResult', () => {
    it('should extract amount from return value', () => {
      const txResult = {
        returnValue: {
          value: () => '2000000000',
        },
      };

      const result = (adapter as any).extractAmountFromResult(
        txResult,
        '1000000000',
      );
      expect(result).toBe('2000000000');
    });

    it('should fallback to provided amount if no return value', () => {
      const txResult = {};
      const result = (adapter as any).extractAmountFromResult(
        txResult,
        '1500000000',
      );
      expect(result).toBe('1500000000');
    });

    it('should return default if no amount provided', () => {
      const txResult = {};
      const result = (adapter as any).extractAmountFromResult(txResult);
      expect(result).toBe('0');
    });
  });
});
