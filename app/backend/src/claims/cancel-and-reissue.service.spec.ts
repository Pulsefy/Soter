import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CancelAndReissueService } from './cancel-and-reissue.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ClaimStatus } from '@prisma/client';
import { CLAIM_EVENT } from './claim.events';

describe('CancelAndReissueService', () => {
  let service: CancelAndReissueService;
  let auditService: AuditService;

  const mockClaim: any = {
    id: 'claim-123',
    campaignId: 'campaign-1',
    status: ClaimStatus.approved,
    amount: 100,
    recipientRef: 'recipient-123',
    evidenceRef: 'evidence-456',
    deletedAt: null,
    campaign: {
      id: 'campaign-1',
      name: 'Test Campaign',
      status: 'active',
      budget: 1000,
      metadata: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockPrismaService = {
    claim: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAuditService = {
    record: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };

  const mockEncryptionService = {
    encrypt: jest.fn((v: string) => (v ? `encrypted:${v}` : v)),
    decrypt: jest.fn((v: string) => (v ? v.replace('encrypted:', '') : v)),
  };

  const mockMetricsService = {
    incrementClaimsCancelled: jest.fn(),
    adjustClaimsInFunnel: jest.fn(),
    incrementClaimsCreated: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CancelAndReissueService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<CancelAndReissueService>(CancelAndReissueService);
    auditService = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  describe('cancel', () => {
    it('should emit ClaimCancelledEvent with all required payload fields', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrismaService.$transaction.mockImplementation(
        (fn: (tx: any) => Promise<any>) => {
          const tx = {
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.cancelled,
                cancelledAt: new Date(),
                cancelledBy: 'operator-1',
                cancelReason: 'Test reason',
              }),
            },
            balanceLedger: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        },
      );

      await service.cancel('claim-123', {
        operatorId: 'operator-1',
        reason: 'Test reason',
      });

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const callArg = (auditService.record as jest.Mock).mock.calls[0][0];

      expect(callArg.actorId).toBe('operator-1');
      expect(callArg.entity).toBe('claim');
      expect(callArg.entityId).toBe('claim-123');
      expect(callArg.action).toBe(CLAIM_EVENT.CANCELLED);

      const metadata = callArg.metadata;
      expect(metadata.type).toBe(CLAIM_EVENT.CANCELLED);
      expect(metadata.claimId).toBe('claim-123');
      expect(metadata.campaignId).toBe('campaign-1');
      expect(metadata.operatorId).toBe('operator-1');
      expect(metadata.reason).toBe('Test reason');
      expect(metadata.unlockedAmount).toBe(100);
      expect(metadata.timestamp).toBeInstanceOf(Date);
    });

    it('should emit ClaimCancelledEvent without optional reason field', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrismaService.$transaction.mockImplementation(
        (fn: (tx: any) => Promise<any>) => {
          const tx = {
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.cancelled,
                cancelledAt: new Date(),
                cancelledBy: 'operator-1',
                cancelReason: null,
              }),
            },
            balanceLedger: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        },
      );

      await service.cancel('claim-123', { operatorId: 'operator-1' });

      const metadata = (auditService.record as jest.Mock).mock.calls[0][0]
        .metadata;
      expect(metadata.claimId).toBe('claim-123');
      expect(metadata.reason).toBeUndefined();
      expect(metadata.unlockedAmount).toBe(100);
    });
  });

  describe('reissue', () => {
    it('should emit ClaimCancelledEvent and ClaimReissuedEvent with all required payload fields', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrismaService.$transaction.mockImplementation(
        (fn: (tx: any) => Promise<any>) => {
          const tx = {
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.cancelled,
                cancelledAt: new Date(),
                cancelledBy: 'operator-1',
              }),
              create: jest.fn().mockResolvedValue({
                id: 'claim-456',
                campaignId: 'campaign-1',
                amount: 100,
                status: ClaimStatus.requested,
                reissuedFromId: 'claim-123',
              }),
            },
            balanceLedger: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        },
      );

      await service.reissue('claim-123', {
        operatorId: 'operator-1',
        reason: 'Reissued for correction',
      });

      expect(auditService.record).toHaveBeenCalledTimes(2);

      // First call: ClaimCancelledEvent
      const cancelCall = (auditService.record as jest.Mock).mock.calls[0][0];
      expect(cancelCall.action).toBe(CLAIM_EVENT.CANCELLED);
      expect(cancelCall.entityId).toBe('claim-123');
      expect(cancelCall.metadata.type).toBe(CLAIM_EVENT.CANCELLED);
      expect(cancelCall.metadata.claimId).toBe('claim-123');
      expect(cancelCall.metadata.campaignId).toBe('campaign-1');
      expect(cancelCall.metadata.operatorId).toBe('operator-1');
      expect(cancelCall.metadata.unlockedAmount).toBe(100);
      expect(cancelCall.metadata.timestamp).toBeInstanceOf(Date);

      // Second call: ClaimReissuedEvent
      const reissueCall = (auditService.record as jest.Mock).mock.calls[1][0];
      expect(reissueCall.action).toBe(CLAIM_EVENT.REISSUED);
      expect(reissueCall.entityId).toBe('claim-456');
      expect(reissueCall.metadata.type).toBe(CLAIM_EVENT.REISSUED);
      expect(reissueCall.metadata.newClaimId).toBe('claim-456');
      expect(reissueCall.metadata.originalClaimId).toBe('claim-123');
      expect(reissueCall.metadata.campaignId).toBe('campaign-1');
      expect(reissueCall.metadata.operatorId).toBe('operator-1');
      expect(reissueCall.metadata.amount).toBe(100);
      expect(reissueCall.metadata.reason).toBe('Reissued for correction');
      expect(reissueCall.metadata.timestamp).toBeInstanceOf(Date);
    });

    it('should emit ClaimReissuedEvent with overridden amount', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrismaService.$transaction.mockImplementation(
        (fn: (tx: any) => Promise<any>) => {
          const tx = {
            claim: {
              update: jest.fn().mockResolvedValue({
                ...mockClaim,
                status: ClaimStatus.cancelled,
                cancelledAt: new Date(),
                cancelledBy: 'operator-1',
              }),
              create: jest.fn().mockResolvedValue({
                id: 'claim-789',
                campaignId: 'campaign-1',
                amount: 250,
                status: ClaimStatus.requested,
                reissuedFromId: 'claim-123',
              }),
            },
            balanceLedger: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return fn(tx);
        },
      );

      await service.reissue('claim-123', {
        operatorId: 'operator-1',
        amount: 250,
        reason: 'Amount correction',
      });

      const reissueCall = (auditService.record as jest.Mock).mock.calls[1][0];
      expect(reissueCall.metadata.amount).toBe(250);
      expect(reissueCall.metadata.newClaimId).toBe('claim-789');
      expect(reissueCall.metadata.originalClaimId).toBe('claim-123');
    });
  });

  describe('error cases', () => {
    it('should throw NotFoundException when claim is not found', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(null);

      await expect(
        service.cancel('nonexistent', { operatorId: 'op-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when claim is soft-deleted', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        ...mockClaim,
        deletedAt: new Date(),
      });

      await expect(
        service.cancel('claim-123', { operatorId: 'op-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when claim is already cancelled', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        ...mockClaim,
        status: ClaimStatus.cancelled,
      });

      await expect(
        service.cancel('claim-123', { operatorId: 'op-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
