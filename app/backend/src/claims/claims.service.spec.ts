import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.module';
import type { DisburseParams } from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { ClaimStatus, Prisma } from '@prisma/client';

describe('ClaimsService', () => {
  let service: ClaimsService;
  let prismaService: PrismaService;
  let _onchainAdapter: OnchainAdapter;
  let _metricsService: MetricsService;
  let _auditService: AuditService;
  let configService: ConfigService;

  const mockClaim = {
    id: 'claim-123',
    campaignId: 'campaign-1',
    status: ClaimStatus.approved,
    amount: new Prisma.Decimal('100.00'),
    recipientRef: 'recipient-123',
    evidenceRef: 'evidence-456',
    createdAt: new Date(),
    updatedAt: new Date(),
    campaign: {
      id: 'campaign-1',
      name: 'Test Campaign',
      status: 'active',
      budget: new Prisma.Decimal('1000.00'),
      metadata: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockDisburse = jest.fn().mockResolvedValue({
    transactionHash: 'mock-tx-hash-123',
    timestamp: new Date(),
    status: 'success' as const,
    amountDisbursed: '1000000000',
    metadata: { adapter: 'mock' },
  });
  const mockOnchainAdapter: Partial<OnchainAdapter> = {
    disburse: mockDisburse,
  };

  const mockMetricsService = {
    incrementOnchainOperation: jest.fn(),
    recordOnchainDuration: jest.fn(),
  };

  const mockAuditService = {
    record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        {
          provide: PrismaService,
          useValue: {
            claim: {
              findUnique: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: mockOnchainAdapter,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string): string | undefined => {
              const config: Record<string, string> = {
                ONCHAIN_ADAPTER: 'mock',
                ONCHAIN_ENABLED: 'true',
              };
              return config[key];
            }) as jest.Mock<(key: string) => string | undefined>,
          } as ConfigService,
        },
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
    prismaService = module.get<PrismaService>(PrismaService);
    _onchainAdapter = module.get<OnchainAdapter>(ONCHAIN_ADAPTER_TOKEN);
    _metricsService = module.get<MetricsService>(MetricsService);
    _auditService = module.get<AuditService>(AuditService);
    configService = module.get(ConfigService);

    jest.clearAllMocks();
  });

  describe('disburse', () => {
    it('should call on-chain adapter when enabled', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      type TxClient = { claim: { update: jest.Mock } };
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(
          async (callback: (tx: TxClient) => Promise<unknown>) => {
            await Promise.resolve();
            return callback({
              claim: {
                update: jest.fn().mockResolvedValue({
                  ...mockClaim,
                  status: ClaimStatus.disbursed,
                }),
              },
            });
          },
        );

      await service.disburse('claim-123');

      expect(mockDisburse).toHaveBeenCalledWith(
        expect.objectContaining<Partial<DisburseParams>>({
          claimId: 'claim-123',
          recipientAddress: 'recipient-123',
          amount: '100',
        }),
      );
    });

    it('should record metrics when adapter is called', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      type TxClient = { claim: { update: jest.Mock } };
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(
          async (callback: (tx: TxClient) => Promise<unknown>) => {
            await Promise.resolve();
            return callback({
              claim: {
                update: jest.fn().mockResolvedValue({
                  ...mockClaim,
                  status: ClaimStatus.disbursed,
                }),
              },
            });
          },
        );

      await service.disburse('claim-123');

      expect(mockMetricsService.incrementOnchainOperation).toHaveBeenCalledWith(
        'disburse',
        'mock',
        'success',
      );
      expect(mockMetricsService.recordOnchainDuration).toHaveBeenCalledWith(
        'disburse',
        'mock',
        expect.any(Number),
      );
    });

    it('should record audit log when adapter is called', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      type TxClient = { claim: { update: jest.Mock } };
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(
          async (callback: (tx: TxClient) => Promise<unknown>) => {
            await Promise.resolve();
            return callback({
              claim: {
                update: jest.fn().mockResolvedValue({
                  ...mockClaim,
                  status: ClaimStatus.disbursed,
                }),
              },
            });
          },
        );

      await service.disburse('claim-123');

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'onchain',
          entityId: 'claim-123',
          action: 'disburse',
          metadata: expect.objectContaining({
            transactionHash: 'mock-tx-hash-123',
            status: 'success',
            adapter: 'mock',
          }),
        }),
      );
    });

    it('should not call adapter when ONCHAIN_ENABLED is false', async () => {
      jest
        .spyOn(configService, 'get')
        .mockImplementation((key: string): string | undefined => {
          if (key === 'ONCHAIN_ENABLED') return 'false';
          if (key === 'ONCHAIN_ADAPTER') return 'mock';
          return undefined;
        });

      // Recreate service with new config
      type TxClient = { claim: { update: jest.Mock } };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaimsService,
          {
            provide: PrismaService,
            useValue: {
              claim: {
                findUnique: jest.fn().mockResolvedValue(mockClaim),
                update: jest.fn(),
              },
              $transaction: jest
                .fn()
                .mockImplementation(
                  async (callback: (tx: TxClient) => Promise<unknown>) => {
                    await Promise.resolve();
                    return callback({
                      claim: {
                        update: jest.fn().mockResolvedValue({
                          ...mockClaim,
                          status: ClaimStatus.disbursed,
                        }),
                      },
                    });
                  },
                ),
            },
          },
          {
            provide: ONCHAIN_ADAPTER_TOKEN,
            useValue: mockOnchainAdapter,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string): string | undefined => {
                if (key === 'ONCHAIN_ENABLED') return 'false';
                if (key === 'ONCHAIN_ADAPTER') return 'mock';
                return undefined;
              }) as jest.Mock<(key: string) => string | undefined>,
            } as ConfigService,
          },
          {
            provide: LoggerService,
            useValue: {
              log: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
            },
          },
          {
            provide: MetricsService,
            useValue: mockMetricsService,
          },
          {
            provide: AuditService,
            useValue: mockAuditService,
          },
        ],
      }).compile();

      const disabledService = module.get(ClaimsService);
      const disburseSpy = jest.spyOn(mockOnchainAdapter, 'disburse');

      await disabledService.disburse('claim-123');

      expect(disburseSpy).not.toHaveBeenCalled();
    });

    it('should handle adapter errors gracefully', async () => {
      const error = new Error('On-chain error');
      jest.spyOn(mockOnchainAdapter, 'disburse').mockRejectedValue(error);
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      type TxClient = { claim: { update: jest.Mock } };
      const transactionSpy = jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(
          async (callback: (tx: TxClient) => Promise<unknown>) => {
            await Promise.resolve();
            return callback({
              claim: {
                update: jest.fn().mockResolvedValue({
                  ...mockClaim,
                  status: ClaimStatus.disbursed,
                }),
              },
            });
          },
        );

      await service.disburse('claim-123');

      // Should still proceed with disbursement
      expect(transactionSpy).toHaveBeenCalled();
      // Should record failed metric
      expect(mockMetricsService.incrementOnchainOperation).toHaveBeenCalledWith(
        'disburse',
        'mock',
        'failed',
      );
      // Should record failed audit
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining<{ action: string }>({
          action: 'disburse_failed',
        }),
      );
    });

    it('should throw NotFoundException if claim does not exist', async () => {
      jest.spyOn(prismaService.claim, 'findUnique').mockResolvedValue(null);

      await expect(service.disburse('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if claim is not in approved status', async () => {
      const unapprovedClaim = {
        ...mockClaim,
        status: ClaimStatus.verified,
      };
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(unapprovedClaim);

      await expect(service.disburse('claim-123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
