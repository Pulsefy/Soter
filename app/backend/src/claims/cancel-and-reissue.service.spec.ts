import { AppException } from '../common/dto/error-response.dto';
import { Test, TestingModule } from '@nestjs/testing';

import { CancelAndReissueService } from './cancel-and-reissue.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { CancelReasonCode, ClaimStatus } from '@prisma/client';
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
        code: CancelReasonCode.duplicate,
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

      await service.cancel('claim-123', {
        operatorId: 'operator-1',
        code: CancelReasonCode.duplicate,
      });

      const metadata = (auditService.record as jest.Mock).mock.calls[0][0]
        .metadata;
      expect(metadata.claimId).toBe('claim-123');
      expect(metadata.reason).toBeUndefined();
      expect(metadata.reasonCode).toBe(CancelReasonCode.duplicate);
      expect(metadata.unlockedAmount).toBe(100);
    });

    it('should record the structured code alongside the free-text detail', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);

      const claimUpdate = jest.fn().mockResolvedValue({
        ...mockClaim,
        status: ClaimStatus.cancelled,
      });
      const ledgerCreate = jest.fn().mockResolvedValue({});
      mockPrismaService.$transaction.mockImplementation(
        (fn: (tx: any) => Promise<any>) =>
          fn({
            claim: { update: claimUpdate },
            balanceLedger: { create: ledgerCreate },
          }),
      );

      await service.cancel('claim-123', {
        operatorId: 'operator-1',
        code: CancelReasonCode.fraud_flag,
        reason: 'Beneficiary appears on two sanction lists',
      });

      const updateData = claimUpdate.mock.calls[0][0].data;
      expect(updateData.cancelReasonCode).toBe(CancelReasonCode.fraud_flag);
      // Free-text detail is preserved, not replaced by the code.
      expect(updateData.cancelReason).toBe(
        'Beneficiary appears on two sanction lists',
      );

      const metadata = (auditService.record as jest.Mock).mock.calls[0][0]
        .metadata;
      expect(metadata.reasonCode).toBe(CancelReasonCode.fraud_flag);

      // The code is recorded on the ledger note so the unlocked entry is
      // greppable without joining back to the claim.
      expect(ledgerCreate.mock.calls[0][0].data.note).toContain('fraud_flag');
    });

    it('should store a null detail while still recording the code', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);

      const claimUpdate = jest.fn().mockResolvedValue({
        ...mockClaim,
        status: ClaimStatus.cancelled,
      });
      mockPrismaService.$transaction.mockImplementation(
        (fn: (tx: any) => Promise<any>) =>
          fn({
            claim: { update: claimUpdate },
            balanceLedger: { create: jest.fn().mockResolvedValue({}) },
          }),
      );

      await service.cancel('claim-123', {
        operatorId: 'operator-1',
        code: CancelReasonCode.recipient_ineligible,
      });

      const updateData = claimUpdate.mock.calls[0][0].data;
      expect(updateData.cancelReasonCode).toBe(
        CancelReasonCode.recipient_ineligible,
      );
      expect(updateData.cancelReason).toBeNull();
    });
  });

  describe('getCancellationReport', () => {
    const groupBy = jest.fn();
    const aggregate = jest.fn();
    const count = jest.fn();

    beforeEach(() => {
      (mockPrismaService.claim as any).groupBy = groupBy;
      (mockPrismaService.claim as any).aggregate = aggregate;
      (mockPrismaService.claim as any).count = count;
    });

    it('groups counts and amounts by code, largest bucket first', async () => {
      groupBy.mockResolvedValue([
        {
          cancelReasonCode: CancelReasonCode.duplicate,
          _count: { _all: 4 },
          _sum: { amount: 400 },
        },
        {
          cancelReasonCode: CancelReasonCode.fraud_flag,
          _count: { _all: 9 },
          _sum: { amount: 9000 },
        },
        {
          cancelReasonCode: CancelReasonCode.evidence_rejected,
          _count: { _all: 1 },
          _sum: { amount: null },
        },
      ]);
      aggregate.mockResolvedValue({
        _count: { _all: 14 },
        _sum: { amount: 9400 },
      });
      count.mockResolvedValue(0);

      const report = await service.getCancellationReport({});

      expect(report.breakdown).toEqual([
        {
          code: CancelReasonCode.fraud_flag,
          count: 9,
          totalAmount: 9000,
        },
        { code: CancelReasonCode.duplicate, count: 4, totalAmount: 400 },
        {
          code: CancelReasonCode.evidence_rejected,
          count: 1,
          totalAmount: 0,
        },
      ]);
      expect(report.totalCancelled).toBe(14);
      expect(report.totalAmount).toBe(9400);
      expect(report.uncodedCount).toBe(0);
    });

    it('excludes NULL codes from the breakdown but still counts them', async () => {
      // groupBy returns a null bucket when some rows have no code; those must
      // not surface as a bogus "null" code in the breakdown.
      groupBy.mockResolvedValue([
        {
          cancelReasonCode: CancelReasonCode.duplicate,
          _count: { _all: 2 },
          _sum: { amount: 200 },
        },
        { cancelReasonCode: null, _count: { _all: 3 }, _sum: { amount: 300 } },
      ]);
      aggregate.mockResolvedValue({
        _count: { _all: 5 },
        _sum: { amount: 500 },
      });
      count.mockResolvedValue(3);

      const report = await service.getCancellationReport({});

      expect(report.breakdown).toEqual([
        { code: CancelReasonCode.duplicate, count: 2, totalAmount: 200 },
      ]);
      expect(report.uncodedCount).toBe(3);
      // Totals must still reconcile with the full set of cancelled claims.
      expect(
        report.breakdown.reduce((sum, b) => sum + b.count, 0) +
          report.uncodedCount,
      ).toBe(report.totalCancelled);
    });

    it('scopes the query to cancelled, non-deleted claims', async () => {
      groupBy.mockResolvedValue([]);
      aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: { amount: null },
      });
      count.mockResolvedValue(0);

      await service.getCancellationReport({});

      expect(groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['cancelReasonCode'],
          where: { status: ClaimStatus.cancelled, deletedAt: null },
        }),
      );
    });

    it('filters on cancelledAt rather than createdAt', async () => {
      groupBy.mockResolvedValue([]);
      aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: { amount: null },
      });
      count.mockResolvedValue(0);

      await service.getCancellationReport({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      const where = groupBy.mock.calls[0][0].where;
      expect(where.cancelledAt).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-02-01T00:00:00.000Z'),
      });
      expect(where.createdAt).toBeUndefined();
    });

    it('applies the campaignId filter', async () => {
      groupBy.mockResolvedValue([]);
      aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: { amount: null },
      });
      count.mockResolvedValue(0);

      await service.getCancellationReport({ campaignId: 'campaign-1' });

      expect(groupBy.mock.calls[0][0].where).toMatchObject({
        campaignId: 'campaign-1',
      });
    });

    it('rejects an unparseable date filter', async () => {
      await expect(
        service.getCancellationReport({ from: 'not-a-date' }),
      ).rejects.toThrow(AppException);
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

    it('should code the original claim as `reissued` and carry the code on both events', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);

      const claimUpdate = jest.fn().mockResolvedValue({
        ...mockClaim,
        status: ClaimStatus.cancelled,
      });
      mockPrismaService.$transaction.mockImplementation(
        (fn: (tx: any) => Promise<any>) =>
          fn({
            claim: {
              update: claimUpdate,
              create: jest.fn().mockResolvedValue({
                id: 'claim-456',
                campaignId: 'campaign-1',
                amount: 100,
                status: ClaimStatus.requested,
                reissuedFromId: 'claim-123',
              }),
            },
            balanceLedger: { create: jest.fn().mockResolvedValue({}) },
          }),
      );

      await service.reissue('claim-123', { operatorId: 'operator-1' });

      // A reissue is always a `reissued` cancellation — the operator does not
      // get to label it something else, so the breakdown stays trustworthy.
      expect(claimUpdate.mock.calls[0][0].data.cancelReasonCode).toBe(
        CancelReasonCode.reissued,
      );

      const calls = (auditService.record as jest.Mock).mock.calls;
      expect(calls[0][0].metadata.reasonCode).toBe(CancelReasonCode.reissued);
      expect(calls[1][0].metadata.reasonCode).toBe(CancelReasonCode.reissued);
    });
  });

  describe('error cases', () => {
    it('should throw NotFoundException when claim is not found', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(null);

      await expect(
        service.cancel('nonexistent', {
          operatorId: 'op-1',
          code: CancelReasonCode.duplicate,
        }),
      ).rejects.toThrow(AppException);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when claim is soft-deleted', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        ...mockClaim,
        deletedAt: new Date(),
      });

      await expect(
        service.cancel('claim-123', {
          operatorId: 'op-1',
          code: CancelReasonCode.duplicate,
        }),
      ).rejects.toThrow(AppException);
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when claim is already cancelled', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue({
        ...mockClaim,
        status: ClaimStatus.cancelled,
      });

      await expect(
        service.cancel('claim-123', {
          operatorId: 'op-1',
          code: CancelReasonCode.duplicate,
        }),
      ).rejects.toThrow(AppException);
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
