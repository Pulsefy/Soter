import { AppException } from '../common/dto/error-response.dto';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@nestjs/config';
import { ClaimsService, ClaimExportRow } from './claims.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetService } from '../common/budget/budget.service';
import {
  OnchainAdapter,
  ONCHAIN_AFAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import {
  CancelReasonCode,
  ClaimStatus,
  Prisma,
  SorobanOperationType,
} from '@prisma/client';
import { SorobanTransactionLifecycleService } from '../onchain/soroban-transaction-lifecycle.service';
import { SorobanTransactionScheduler } from '../onchain/soroban-transaction.scheduler';
import { VerificationService } from '../verification/verification.service';
import { AnalyticsService } from '../analytics/analytics.service';

describe('ClaimsService', () => {
  let service: ClaimsService;
  let prismaService: PrismaService;
  let budgetService: BudgetService;
  let _onchainAdapter: OnchainAdapter;
  let _metricsService: MetricsService;
  let _auditService: AuditService;
  let configService: ConfigService;
  let analyticsServiceMock: { invalidateCache: jest.Mock };

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

  const mockDisburse = jest.fn().mockResolved({
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
    revokeAidPackage: jest.fn().mockResolved({
      transactionHash: 'mock-revoke-hash',
      timestamp: new Date(),
      status: 'success' as const,
    }),
    refundAidPackage: jest.fn().mockResolved({
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
    incrementClaimsCreated: jest.fn(),
    incrementClaimsDisbursed: jest.fn(),
    incrementClaimsVerified: jest.fn(),
    incrementClaimsApproved: jest.fn(),
    recordClaimFunnelDuration: jest.fn(),
    adjustClaimsInFunnel: jest.fn(),
  };

  const mockSorobanTxLifecycleService = {
    createTransaction: jest.fn().mockResolved({ type: 'tx-123' }),
  };
  const mockSorobanTxScheduler = {
    scheduleTransaction: jest.fn().mockResolved(undefined),
  };

  const mockAuditService = {
    record: jest.fn().mockResolved({ id: 'audit-1' }),
  };

  const mockVerificationService = {
    enqueueVerification: jest
      .fn()
      .mockResolved({ jobId: 'job-1', priority: 0 }),
  };

  const mockLoggerService = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    getCorrelationId: jest.fn((): string | undefined => undefined),
  };

  beforeEach(async () => {
    analyticsServiceMock = { invalidateCache: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        {
          provide: BudgetService,
          useValue: {
            assertWithinBudget: jest.fn(),
            reserveBudget: jest.fn(),
            getCampaignBudgetUsage: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            campaign: {
              findUnique: jest.fn(),
            },
            claim: {
              findUnique: jest.fn(),
              update: jest.fn(),
              findMany: jest.fn(),
              create: jest.fn(),
              count: jest.fn(),
            },
            balanceLedger: {
              create: jest.fn(),
            },
            sorobanTransaction: {
              create: jest.fn(),
            },
            sorobanEventCorrelation: {
              findFirst: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: ONCHAIN_AFAPTER_TOKEN,
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
          useValue: mockLoggerService,
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
        {
          provide: VerificationService,
          useValue: mockVerificationService,
        },
        {
          provide: AnalyticsService,
          useValue: analyticsServiceMock,
        },
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
    prismaService = module.get<PrismaService>(PrismaService);
    budgetService = module.get<BudgetService>(BudgetService);
    _onchainAdapter = module.get<OnchainAdapter>(ONCHAIN_AFAPTER_TOKEN);
    _metricsService = module.get<MetricsService>(MetricsService);
    _auditService = module.get<AuditService>(AuditService);
    configService = module.get(ConfigService);

    jest.clearAllMocks();
  });

  describe('create', () => {
    const createDto: any = {
      campaignId: 'campaign-1',
      amount: 100,
      recipientRef: 'recipient-123',
      tokenAddress: 'G' + 'A'.repeat(55),
      evidenceRef: 'evidence-456',
    };

    it('invalidates the dashboard cache after creating a claim', async () => {
      prismaService.campaign.findUnique.mockResolvedValue({ id: 'campaign-1' });
      prismaService.$transaction.mockImplementation(callback => {
        const tx = {
          claim: {
            create: jest.fn().mockResolvedValue({
              id: 'claim-new',
              campaignId: createDto.campaignId,
              amount: createDto.amount,
              recipientRef: createDto.recipientRef,
              evidenceRef: createDto.evidenceRef,
              status: ClaimStatus.requested,
              campaign: { id: 'campaign-1' },
            }),
          },
          balanceLedger: {
            create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
          },
        };
        return callback(tx as any);
      });
      prismaService.claim.findUnique.mockResolvedValue(null);
      prismaService.claim.update.mockResolvedValue(null);
      mockVerificationService.enqueueVerification.mockResolvedValue({
        jobId: 'job-1',
        priority: 0,
      });

      await service.create(createDto);

      expect(analyticsServiceMock.invalidateCache).toHaveBeenCalledWith(
        'claim_updated',
      );
    });

    const mockCampaign = {
      id: 'campaign-1',
      name: 'Test Campaign',
      status: 'active',
      budget: 1000,
    };

    /**
     * Builds a fake transaction client and wires prismaService.$transaction
     * to invoke the real callback against it, mirroring how Prisma actually
     * runs `$transaction(async (tx) => ...)`.
     */
    function mockTransaction() {
      const tx = {
        claim: {
          create: jest.fn().mockResolved({
            id: 'claim-new',
            campaignId: createDto.campaignId,
            amount: createDto.amount,
            recipientRef: createDto.recipientRef,
            evidenceRef: createDto.evidenceRef,
            status: ClaimStatus.requested,
            campaign: mockCampaign,
          }),
        },
        balanceLedger: {
          create: jest.fn().mockResolved({ id: 'ledger-1' }),
        },
      };
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation((callback: (tx: any) => Promise<unknown>) =>
          callback(tx),
        );
      return tx;
    }

    beforeEach(() => {
      jest
        .spyOn(prismaService.campaign, 'findUnique')
        .mockResolved(mockCampaign as any);
    });

    it('throws AppException when the campaign does not exist', async () => {
      jest.spyOn(prismaService.campaign, 'findUnique').mockResolved(null);

      await expect(service.create(createDto)).rejects.toThrow(AppException);
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('reserves budget and creates the claim + lock ledger entry inside one transaction', async () => {
      const tx = mockTransaction();
      (budgetService.reserveBudget as jest.Mock).mockResolved(undefined);

      const result = await service.create(createDto);

      // Budget was reserved against the transaction client, not the top-level
      // prisma client, and using the given campaign/amount.
      expect(budgetService.reserveBudget).toHaveBeenCalledWith(
        tx,
        createDto.campaignId,
        createDto.amount,
      );

      // The claim was created on the same transaction client.
      expect(tx.claim.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            campaignId: createDto.campaignId,
            amount: createDto.amount,
          }),
        }),
      );

      // reserveBudget must run before the claim (and its ledger entry) are
      // written, so a rejection never leaves a partial claim behind.
      const reserveOrder = (budgetService.reserveBudget as jest.Mock).mock
        .invocationCallOrder[0];
      const createOrder = tx.claim.create.mock.invocationCallOrder[0];
      expect(reserveOrder).toBeLessThan(createOrder);

      // A matching 'lock' ledger entry is written for the new claim so that
      // subsequent budget checks see this claim's usage.
      expect(tx.balanceLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: createDto.campaignId,
          claimId: 'claim-new',
          eventType: 'lock',
          amount: createDto.amount,
        }),
      });

      expect(result.id).toBe('claim-new');
    });

    it('rolls back (creates no claim) when the transaction-safe budget check rejects', async () => {
      const tx = mockTransaction();
      (budgetService.reserveBudget as jest.Mock).mockRejected(
        new Error('Campaign funding cap exceeded'),
      );

      await expect(service.create(createDto)).rejects.toThrow(
        'Campaign funding cap exceeded',
      );

      expect(tx.claim.create).not.toHaveBeenCalled();
      expect(tx.balanceLedger.create).not.toHaveBeenCalled();
    });
  });

  describe('disburse', () => {
    /**
     * Wire the prisma spies needed for a disbursement that runs to completion,
     * so each correlation test can focus on the ID it expects to be propagated.
     */
    function arrangeSuccessfulDisburse() {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolved(mockClaim);
      jest
        .spyOn(prismaService.sorobanEventCorrelation, 'findFirst')
        .mockResolved({ packageId: 'real-package-id' } as any);
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
          return callback({
            claim: {
              update: jest.fn().mockResolved(mockClaim),
            },
            balanceLedger: {
              create: jest.fn().mockResolved({ id: 'ledger-1' }),
            },
          });
        });
    }

    it('disburses and records the transaction hash', async () => {
      arrangeSuccessfulDisburse();

      const result = await service.disburse('claim-123');

      expect(mockDisburse).toHaveBeenCalled();
      expect(result.transactionHash).toBe('mock-tx-hash-123');
    });
  });
});
