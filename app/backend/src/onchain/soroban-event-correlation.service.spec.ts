import { Test, TestingModule } from '@nestjs/testing';
import {
  SorobanEventCorrelationService,
  SorobanEvent,
} from './soroban-event-correlation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics/metrics.service';

describe('SorobanEventCorrelationService', () => {
  let service: SorobanEventCorrelationService;

  const mockPrismaService = {
    sorobanEventCorrelation: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        AID_ESCROW_CONTRACT_ID: 'test-contract-id',
        STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
        STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      };
      return config[key] || defaultValue;
    }),
  };

  const mockMetricsService = {
    recordHistogram: jest.fn(),
    incrementCounter: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanEventCorrelationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<SorobanEventCorrelationService>(
      SorobanEventCorrelationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractIdentifiers', () => {
    it('should extract package_id from event payload with package_id field', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: {
          package_id: 'pkg_123456789',
          recipient: 'GABC...',
          amount: '1000',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: 'pkg_123456789' });
    });

    it('should extract package_id from event payload with packageId field', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: {
          packageId: 'pkg_987654321',
          recipient: 'GABC...',
          amount: '2000',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: 'pkg_987654321' });
    });

    it('should extract package_id from nested data structure', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: {
          data: {
            package_id: 'pkg_nested_123',
          },
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: 'pkg_nested_123' });
    });

    it('should extract claim_id from event payload with claim_id field', () => {
      const event: SorobanEvent = {
        topic: 'claim_created',
        payload: {
          claim_id: 'claim_abc123',
          amount: '500',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ claimId: 'claim_abc123' });
    });

    it('should extract claim_id from event payload with claimId field', () => {
      const event: SorobanEvent = {
        topic: 'claim_created',
        payload: {
          claimId: 'claim_xyz789',
          amount: '500',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ claimId: 'claim_xyz789' });
    });

    it('should extract claim_id from nested data structure', () => {
      const event: SorobanEvent = {
        topic: 'claim_created',
        payload: {
          data: {
            claim_id: 'claim_nested_456',
          },
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ claimId: 'claim_nested_456' });
    });

    it('should extract claim_id from metadata.claim_ref', () => {
      const event: SorobanEvent = {
        topic: 'claim_approved',
        payload: {
          metadata: {
            claim_ref: 'claim_metadata_789',
          },
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ claimId: 'claim_metadata_789' });
    });

    it('should return empty object when payload is null', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: null,
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({});
    });

    it('should return empty object when payload has no identifiers', () => {
      const event: SorobanEvent = {
        topic: 'config_updated',
        payload: {
          setting: 'fee_percentage',
          value: '10',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({});
    });

    it('should prioritize package_id over claim_id', () => {
      const event: SorobanEvent = {
        topic: 'package_claimed',
        payload: {
          package_id: 'pkg_123',
          claim_id: 'claim_456',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: 'pkg_123' });
    });

    it('should extract id field as package_id', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: {
          id: 'pkg_id_field_123',
          amount: '1000',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: 'pkg_id_field_123' });
    });

    it('should extract package from event payload', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: {
          package: 'pkg_package_field_456',
          amount: '1000',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: 'pkg_package_field_456' });
    });

    it('should extract claim from event payload', () => {
      const event: SorobanEvent = {
        topic: 'claim_created',
        payload: {
          claim: 'claim_field_789',
          amount: '500',
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ claimId: 'claim_field_789' });
    });

    it('should handle numeric values by converting to string', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: {
          package_id: 12345,
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: '12345' });
    });

    it('should handle bigint values by converting to string', () => {
      const event: SorobanEvent = {
        topic: 'package_created',
        payload: {
          package_id: BigInt('99999999999999999'),
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      expect(result).toEqual({ packageId: '99999999999999999' });
    });

    it('should extract both package_id and claim_id when both are present in different paths', () => {
      const event: SorobanEvent = {
        topic: 'package_claimed',
        payload: {
          package_id: 'pkg_123',
          data: {
            claim_id: 'claim_456',
          },
        },
        txHash: 'abc123def456',
        ledger: 12345,
        eventIndex: 0,
      };

      const result = service.extractIdentifiers(event);
      // Should return package_id first since it's checked first
      expect(result).toEqual({ packageId: 'pkg_123' });
    });
  });
});
