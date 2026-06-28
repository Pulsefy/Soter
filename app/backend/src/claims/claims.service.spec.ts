import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetService } from '../common/budget/budget.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ClaimStatus, Prisma } from '@prisma/client';
import { SorobanTransactionLifecycleService } from '../onchain/soroban-transaction-lifecycle.service';
import { SorobanTransactionScheduler } from '../onchain/soroban-transaction.scheduler';

describe('ClaimsService', () => {
  let service: ClaimsService;
  let prismaService: PrismaService;
  let _onchainAdapter: OnchainAdapter;
  let _metricsService: MetricsService;
  let _auditService: AuditService;
  let configService: ConfigService;

  // Typed as any to bypass strict checks on newer structural fields like expiresAt, cancelledAt, etc.
  const mockClaim: any = {
    id: 'claim-123',
    campaignId: 'campaign-1',
    status: ClaimStatus.approved,
    amount: new Prisma.Decimal('100.00'),
    recipientRef: 'recipient-123',
    evidenceRef: 'evidence-456',
    expiresAt: new Date(Date.now() + 3600_000),
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
  const mockOnchainAdapter: Partial<OnchainAdapter> & {
    revokeAidPackage: jest.Mock;
    refundAidPackage: jest.Mock;
  } = {
    disburse: mockDisburse,
    revokeAidPackage: jest.fn().mockResolvedValue({
      transactionHash: 'mock-revoke-hash',
      timestamp: new Date(),
      status: 'success' as const,
    }),
    refundAidPackage: jest.fn().mockResolvedValue({
      transactionHash: 'mock-refund-hash',
      timestamp: new Date(),
      status: 'success' as const,
      amountRefunded: '1000000000',
    }),
  };

  const mockMetricsService = {
    incrementOnchainOperation: jest.fn(),
    recordOnchainDuration: jest.fn(),
    incrementCounter: jest.fn(),
  };

  const mockSorobanTxLifecycleService = {
    createTransaction: jest.fn().mockResolvedValue({ id: 'tx-123' }),
  };
  const mockSorobanTxScheduler = {
    scheduleTransaction: jest.fn().mockResolvedValue(undefined),
  };

  const mockAuditService = {
    record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        {
          provide: BudgetService,
          useValue: {
            assertWithinBudget: jest.fn(),
            getCampaignBudgetUsage: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            claim: {
              findUnique: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
            },
            sorobanTransaction: {
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
            }),
          },
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
        {
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn((v: string) => v),
            decrypt: jest.fn((v: string) => v),
            encryptDeterministic: jest.fn((v: string) => v),
            decryptDeterministic: jest.fn((v: string) => v),
          },
        },
        {
          provide: SorobanTransactionLifecycleService,
          useValue: mockSorobanTxLifecycleService,
        },
        {
          provide: SorobanTransactionScheduler,
          useValue: mockSorobanTxScheduler,
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
    it('should create and schedule a Soroban transaction when onchain is enabled', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
          await Promise.resolve();
          return callback({
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.disbursed,
              }),
            },
          });
        });

      await service.disburse('claim-123');

      expect(
        mockSorobanTxLifecycleService.createTransaction,
      ).toHaveBeenCalled();
      expect(mockSorobanTxScheduler.scheduleTransaction).toHaveBeenCalled();
    });

    it('should record metrics when Soroban transaction is scheduled', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
          await Promise.resolve();
          return callback({
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.disbursed,
              }),
            },
          });
        });

      await service.disburse('claim-123');

      expect(mockMetricsService.incrementCounter).toHaveBeenCalled();
    });

    it('should transition claim status to disbursed', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      const transactionMock = jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
          await Promise.resolve();
          return callback({
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.disbursed,
              }),
            },
          });
        });

      const result = await service.disburse('claim-123');

      expect(transactionMock).toHaveBeenCalled();
      expect(result.status).toEqual(ClaimStatus.disbursed);
    });

    it('should not schedule Soroban transaction when ONCHAIN_ENABLED is false', async () => {
      jest
        .spyOn(configService, 'get')
        .mockImplementation((key: string): string | undefined => {
          if (key === 'ONCHAIN_ENABLED') return 'false';
          if (key === 'ONCHAIN_ADAPTER') return 'mock';
          return undefined;
        });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaimsService,
          {
            provide: BudgetService,
            useValue: {
              assertWithinBudget: jest.fn(),
              getCampaignBudgetUsage: jest.fn(),
            },
          },
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
                  async (callback: (tx: any) => Promise<unknown>) => {
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
              }),
            },
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
          {
            provide: EncryptionService,
            useValue: {
              encrypt: jest.fn((v: string) => v),
              decrypt: jest.fn((v: string) => v),
              encryptDeterministic: jest.fn((v: string) => v),
              decryptDeterministic: jest.fn((v: string) => v),
            },
          },
          {
            provide: SorobanTransactionLifecycleService,
            useValue: mockSorobanTxLifecycleService,
          },
          {
            provide: SorobanTransactionScheduler,
            useValue: mockSorobanTxScheduler,
          },
        ],
      }).compile();

      const disabledService = module.get(ClaimsService);
      const createTxSpy = jest.spyOn(
        mockSorobanTxLifecycleService,
        'createTransaction',
      );
      const scheduleTxSpy = jest.spyOn(
        mockSorobanTxScheduler,
        'scheduleTransaction',
      );

      await disabledService.disburse('claim-123');

      expect(createTxSpy).not.toHaveBeenCalled();
      expect(scheduleTxSpy).not.toHaveBeenCalled();
    });

    it('should transition claim status even if onchain processing is handled separately', async () => {
      const error = new Error('Onchain error');
      jest.spyOn(mockOnchainAdapter, 'disburse').mockRejectedValue(error);
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      const transactionSpy = jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
          await Promise.resolve();
          return callback({
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.disbursed,
              }),
            },
          });
        });

      await service.disburse('claim-123');

      expect(transactionSpy).toHaveBeenCalled();
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

  describe('cleanupExpiredClaims', () => {
    it('archives requested and verified claims whose expiry has passed', async () => {
      const expiredClaim = {
        ...mockClaim,
        status: ClaimStatus.requested,
        expiresAt: new Date('2026-04-01T00:00:00.000Z'),
      };

      jest
        .spyOn(prismaService.claim, 'findMany')
        .mockResolvedValue([expiredClaim] as never);
      jest.spyOn(prismaService.claim, 'update').mockResolvedValue({
        ...expiredClaim,
        status: ClaimStatus.archived,
      } as never);

      const result = await service.cleanupExpiredClaims(
        new Date('2026-04-29T00:00:00.000Z'),
      );

      expect(result).toEqual({ processed: 1, archived: 1 });
      expect(prismaService.claim.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          status: {
            in: [ClaimStatus.requested, ClaimStatus.verified],
          },
          expiresAt: {
            lt: new Date('2026-04-29T00:00:00.000Z'),
          },
        },
      });
      expect(prismaService.claim.update).toHaveBeenCalledWith({
        where: { id: expiredClaim.id },
        data: { status: ClaimStatus.archived },
      });
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'claim',
          entityId: expiredClaim.id,
          action: 'expired_cleanup',
        }),
      );
    });

    it('skips cleanup gracefully when the adapter does not support revoke/refund', async () => {
      const expiredClaim = {
        ...mockClaim,
        status: ClaimStatus.verified,
        expiresAt: new Date('2026-04-01T00:00:00.000Z'),
      };
      delete (mockOnchainAdapter as Record<string, unknown>).revokeAidPackage;
      delete (mockOnchainAdapter as Record<string, unknown>).refundAidPackage;

      jest
        .spyOn(prismaService.claim, 'findMany')
        .mockResolvedValue([expiredClaim] as never);
      jest.spyOn(prismaService.claim, 'update').mockResolvedValue({
        ...expiredClaim,
        status: ClaimStatus.archived,
      } as never);

      await service.cleanupExpiredClaims(new Date('2026-04-29T00:00:00.000Z'));

      expect(prismaService.claim.update).toHaveBeenCalled();
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'expired_cleanup',
          metadata: expect.objectContaining({
            onchain: expect.objectContaining({
              attempted: false,
              skippedReason: 'adapter_missing_cleanup_methods',
            }),
          }),
        }),
      );
    });
  });
});
