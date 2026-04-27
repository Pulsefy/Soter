import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimsService } from './claims.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import type { DisburseParams } from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
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
    expiresAt: null,
    deletedAt: null,
    metadata: null,
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

  const mockRevokeAidPackage = jest.fn().mockResolvedValue({
    packageId: 'package-123',
    transactionHash: 'mock-revoke-tx-hash',
    timestamp: new Date(),
    status: 'success' as const,
    amountRefunded: '1000000000',
    metadata: { adapter: 'mock' },
  });

  const mockOnchainAdapter: Partial<OnchainAdapter> = {
    disburse: mockDisburse,
    revokeAidPackage: mockRevokeAidPackage,
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

  describe('cleanupExpiredClaims', () => {
    const mockExpiredClaim = {
      id: 'claim-expired-1',
      campaignId: 'campaign-1',
      status: ClaimStatus.requested,
      amount: new Prisma.Decimal('50.00'),
      recipientRef: 'recipient-456',
      evidenceRef: 'evidence-789',
      expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      deletedAt: null,
      metadata: { packageId: 'package-123' },
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

    const mockExpiredClaimVerified = {
      ...mockExpiredClaim,
      id: 'claim-expired-2',
      status: ClaimStatus.verified,
      metadata: { packageId: 'package-456' },
    };

    it('should log and return when no expired claims found', async () => {
      jest
        .spyOn(prismaService.claim, 'findMany')
        .mockResolvedValue([]);

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.cleanupExpiredClaims();

      expect(loggerSpy).toHaveBeenCalledWith('Starting expired claims cleanup job');
      expect(loggerSpy).toHaveBeenCalledWith('No expired claims found');
      expect(prismaService.claim.update).not.toHaveBeenCalled();
      expect(mockAuditService.record).not.toHaveBeenCalled();
    });

    it('should process expired claims successfully when onchain is disabled', async () => {
      const mockFindMany = jest.fn().mockResolvedValue([mockExpiredClaim, mockExpiredClaimVerified]);
      const mockUpdate = jest.fn().mockResolvedValue({ status: ClaimStatus.expired });

      // Disable onchain
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaimsService,
          {
            provide: PrismaService,
            useValue: {
              claim: {
                findMany: mockFindMany,
                update: mockUpdate,
              },
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
        ],
      }).compile();

      const disabledService = module.get(ClaimsService);

      await disabledService.cleanupExpiredClaims();

      // Should update both claims to expired status
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'claim-expired-1' },
          data: { status: ClaimStatus.expired },
        })
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'claim-expired-2' },
          data: { status: ClaimStatus.expired },
        })
      );

      // Should create audit logs for each claim
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'claim',
          entityId: 'claim-expired-1',
          action: 'expired',
        })
      );
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'claim',
          entityId: 'claim-expired-2',
          action: 'expired',
        })
      );

      // Should create summary audit log
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'claim',
          entityId: 'cleanup_job',
          action: 'cleanup_expired_completed',
          metadata: expect.objectContaining({
            totalProcessed: 2,
            successCount: 2,
            failureCount: 0,
          }),
        })
      );

      // Should NOT call onchain revoke
      expect(mockRevokeAidPackage).not.toHaveBeenCalled();
    });

    it('should call onchain revoke when onchain is enabled and packageId exists', async () => {
      const mockFindMany = jest.fn().mockResolvedValue([mockExpiredClaim, mockExpiredClaimVerified]);
      const mockUpdate = jest.fn().mockResolvedValue({ status: ClaimStatus.expired });

      // Recreate service with mocks
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaimsService,
          {
            provide: PrismaService,
            useValue: {
              claim: {
                findMany: mockFindMany,
                update: mockUpdate,
              },
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
                if (key === 'ONCHAIN_ENABLED') return 'true';
                if (key === 'ONCHAIN_ADAPTER') return 'mock';
                if (key === 'SOROBAN_OPERATOR_ADDRESS') return 'admin';
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
        ],
      }).compile();

      const testService = module.get(ClaimsService);

      await testService.cleanupExpiredClaims();

      // Should call revokeAidPackage for each claim with packageId
      expect(mockRevokeAidPackage).toHaveBeenCalledTimes(2);
      expect(mockRevokeAidPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          packageId: 'package-123',
          operatorAddress: 'admin',
        })
      );
      expect(mockRevokeAidPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          packageId: 'package-456',
          operatorAddress: 'admin',
        })
      );

      // Should create onchain revoke audit logs
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'onchain',
          entityId: 'claim-expired-1',
          action: 'revoke_expired',
          metadata: expect.objectContaining({
            packageId: 'package-123',
            transactionHash: 'mock-revoke-tx-hash',
            status: 'success',
          }),
        })
      );

      // Should update claims to expired status
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it('should continue with status update even if onchain revoke fails', async () => {
      const revokeError = new Error('Onchain revoke failed');
      mockRevokeAidPackage.mockRejectedValueOnce(revokeError);

      const mockFindMany = jest.fn().mockResolvedValue([mockExpiredClaim]);
      const mockUpdate = jest.fn().mockResolvedValue({ status: ClaimStatus.expired });

      // Recreate service with mocks
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ClaimsService,
          {
            provide: PrismaService,
            useValue: {
              claim: {
                findMany: mockFindMany,
                update: mockUpdate,
              },
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
                if (key === 'ONCHAIN_ENABLED') return 'true';
                if (key === 'ONCHAIN_ADAPTER') return 'mock';
                if (key === 'SOROBAN_OPERATOR_ADDRESS') return 'admin';
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
        ],
      }).compile();

      const testService = module.get(ClaimsService);
      const loggerSpy = jest.spyOn(testService['logger'], 'error');

      await testService.cleanupExpiredClaims();

      // Should log the error
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Onchain revoke failed for claim claim-expired-1'),
        expect.any(String)
      );

      // Should log failed revoke attempt to audit
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'onchain',
          entityId: 'claim-expired-1',
          action: 'revoke_expired_failed',
          metadata: expect.objectContaining({
            packageId: 'package-123',
            error: 'Onchain revoke failed',
          }),
        })
      );

      // Should still update claim status to expired
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'claim-expired-1' },
          data: { status: ClaimStatus.expired },
        })
      );

      // Should create audit log for claim expiration
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'claim',
          entityId: 'claim-expired-1',
          action: 'expired',
        })
      );
    });

    it('should handle mixed success and failure scenarios', async () => {
      const failingClaim = {
        ...mockExpiredClaim,
        id: 'claim-expired-3',
        status: ClaimStatus.requested,
        deletedAt: null,
      };

      jest
        .spyOn(prismaService.claim, 'findMany')
        .mockResolvedValue([mockExpiredClaim, mockExpiredClaimVerified, failingClaim]);

      // Mock update to fail for the third claim
      jest
        .spyOn(prismaService.claim, 'update')
        .mockImplementation(async (args: any) => {
          if (args.where.id === 'claim-expired-3') {
            throw new Error('Database update failed');
          }
          return { ...args.where, status: ClaimStatus.expired };
        });

      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const errorSpy = jest.spyOn(service['logger'], 'error');

      await service.cleanupExpiredClaims();

      // Should log completion with failure count
      expect(loggerSpy).toHaveBeenCalledWith(
        'Expired claims cleanup job completed',
        expect.objectContaining({
          total: 3,
          success: 2,
          failed: 1,
          failedClaimIds: ['claim-expired-3'],
        })
      );

      // Should log the error for failed claim
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process expired claim claim-expired-3'),
        expect.any(String)
      );

      // Summary audit log should include failed claim IDs
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cleanup_expired_completed',
          metadata: expect.objectContaining({
            totalProcessed: 3,
            successCount: 2,
            failureCount: 1,
            failedClaimIds: ['claim-expired-3'],
          }),
        })
      );
    });

    it('should handle job-level errors and log failure', async () => {
      const jobError = new Error('Database connection failed');
      jest
        .spyOn(prismaService.claim, 'findMany')
        .mockRejectedValue(jobError);

      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service.cleanupExpiredClaims()).rejects.toThrow(jobError);

      // Should log the error
      expect(errorSpy).toHaveBeenCalledWith(
        'Expired claims cleanup job failed:',
        'Database connection failed',
        expect.any(String)
      );

      // Should log job failure to audit
      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
          entity: 'claim',
          entityId: 'cleanup_job',
          action: 'cleanup_expired_failed',
          metadata: expect.objectContaining({
            error: 'Database connection failed',
          }),
        })
      );
    });
  });
});
