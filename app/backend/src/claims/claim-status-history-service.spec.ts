import { Test, TestingModule } from '@nestjs/testing';
import { ClaimsService } from './claims.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { BudgetService } from '../common/budget/budget.service';
import { SorobanTransactionLifecycleService } from '../onchain/soroban-transaction-lifecycle.service';
import { SorobanTransactionScheduler } from '../onchain/soroban-transaction.scheduler';
import { VerificationService } from '../verification/verification.service';
import { AppException } from '../common/dto/error-response.dto';
import { AnalyticsService } from '../analytics/analytics.service';

describe('ClaimsService - getStatusHistory', () => {
  let service: ClaimsService;
  let prismaService: {
    claim: any;
    auditLog: any;
  };

  const claimId = 'claim-123';
  const campaignId = 'campaign-456';

  beforeEach(async () => {
    prismaService = {
      claim: {
        findUnique: jest.fn(),
      },
      auditLog: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: LoggerService, useValue: { log: jest.fn() } },
        { provide: MetricsService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: EncryptionService, useValue: {} },
        { provide: BudgetService, useValue: {} },
        { provide: SorobanTransactionLifecycleService, useValue: {} },
        { provide: SorobanTransactionScheduler, useValue: {} },
        { provide: VerificationService, useValue: {} },
        { provide: AnalyticsService, useValue: { invalidateCache: jest.fn() } },
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
  });

  describe('getStatusHistory', () => {
    const mockClaim = {
      id: claimId,
      campaignId,
      campaign: { id: campaignId, orgId: 'org-123' },
      status: 'disbursed',
      amount: 100,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      deletedAt: null,
    };

    it('returns empty history for claims with no recorded status transitions', async () => {
      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue([]);

      const result = await service.getStatusHistory(claimId);

      expect(result.claimId).toBe(claimId);
      expect(result.history).toEqual([]);
      expect(result.historicalCoverageNote).toContain(
        'No status transitions recorded',
      );
    });

    it('transforms audit logs into status history entries', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          action: 'status_changed_to_requested',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          metadata: { from: undefined, to: 'requested' },
        },
        {
          id: 'log-2',
          action: 'status_changed_to_verified',
          timestamp: new Date('2026-01-01T11:00:00Z'),
          metadata: {
            from: 'requested',
            to: 'verified',
            verificationScore: 0.95,
          },
        },
      ];

      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue(auditLogs);

      const result = await service.getStatusHistory(claimId);

      expect(result.history).toHaveLength(2);
      expect(result.history[0].newStatus).toBe('requested');
      expect(result.history[1].newStatus).toBe('verified');
      expect(result.history[1].previousStatus).toBe('requested');
    });

    it('includes metadata fields like verificationScore', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          action: 'status_changed_to_verified',
          timestamp: new Date('2026-01-01T11:00:00Z'),
          metadata: {
            from: 'requested',
            to: 'verified',
            verificationScore: 0.95,
          },
        },
      ];

      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue(auditLogs);

      const result = await service.getStatusHistory(claimId);

      expect(result.history[0].metadata?.verificationScore).toBe(0.95);
    });

    it('includes cancel reason code and reason in metadata', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          action: 'status_changed_to_cancelled',
          timestamp: new Date('2026-01-01T14:00:00Z'),
          metadata: {
            from: 'approved',
            to: 'cancelled',
            code: 'duplicate',
            reason: 'Duplicate claim from same recipient',
          },
        },
      ];

      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue(auditLogs);

      const result = await service.getStatusHistory(claimId);

      expect(result.history[0].metadata?.cancelReasonCode).toBe('duplicate');
      expect(result.history[0].metadata?.cancelReason).toBe(
        'Duplicate claim from same recipient',
      );
    });

    it('infers trigger type from status transition', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          action: 'status_changed_to_requested',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          metadata: { from: undefined, to: 'requested' },
        },
        {
          id: 'log-2',
          action: 'status_changed_to_verified',
          timestamp: new Date('2026-01-01T11:00:00Z'),
          metadata: { from: 'requested', to: 'verified' },
        },
        {
          id: 'log-3',
          action: 'status_changed_to_approved',
          timestamp: new Date('2026-01-01T12:00:00Z'),
          metadata: { from: 'verified', to: 'approved' },
        },
        {
          id: 'log-4',
          action: 'status_changed_to_cancelled',
          timestamp: new Date('2026-01-01T13:00:00Z'),
          metadata: { from: 'approved', to: 'cancelled', code: 'fraud_flag' },
        },
      ];

      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue(auditLogs);

      const result = await service.getStatusHistory(claimId);

      expect(result.history[1].trigger).toBe('manual_verification');
      expect(result.history[2].trigger).toBe('manual_approval');
      expect(result.history[3].trigger).toBe('manual_cancellation');
    });

    it('throws NOT_FOUND for nonexistent claim', async () => {
      prismaService.claim.findUnique.mockResolvedValue(null);

      await expect(service.getStatusHistory(claimId)).rejects.toThrow(
        AppException,
      );
    });

    it('throws NOT_FOUND for soft-deleted claim', async () => {
      const deletedClaim = { ...mockClaim, deletedAt: new Date() };
      prismaService.claim.findUnique.mockResolvedValue(deletedClaim);

      await expect(service.getStatusHistory(claimId)).rejects.toThrow(
        AppException,
      );
    });

    it('sets historicalCoverageStart to claim creation time', async () => {
      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue([]);

      const result = await service.getStatusHistory(claimId);

      expect(result.historicalCoverageStart).toBe('2026-01-01T10:00:00.000Z');
    });

    it('detects incomplete history when first audit log is after claim creation', async () => {
      const laterClaim = {
        ...mockClaim,
        createdAt: new Date('2026-01-01T10:00:00Z'),
      };
      const laterAuditLog = {
        id: 'log-1',
        action: 'status_changed_to_verified',
        timestamp: new Date('2026-01-01T12:00:00Z'), // 2 hours later
        metadata: { from: 'requested', to: 'verified' },
      };

      prismaService.claim.findUnique.mockResolvedValue(laterClaim);
      prismaService.auditLog.findMany.mockResolvedValue([laterAuditLog]);

      const result = await service.getStatusHistory(claimId);

      expect(result.historicalCoverageNote).toContain('Incomplete history');
    });

    it('orders history entries chronologically (oldest to newest)', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          action: 'status_changed_to_requested',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          metadata: { from: undefined, to: 'requested' },
        },
        {
          id: 'log-2',
          action: 'status_changed_to_verified',
          timestamp: new Date('2026-01-01T11:00:00Z'),
          metadata: { from: 'requested', to: 'verified' },
        },
        {
          id: 'log-3',
          action: 'status_changed_to_approved',
          timestamp: new Date('2026-01-01T12:00:00Z'),
          metadata: { from: 'verified', to: 'approved' },
        },
        {
          id: 'log-4',
          action: 'status_changed_to_disbursed',
          timestamp: new Date('2026-01-01T13:00:00Z'),
          metadata: {
            from: 'approved',
            to: 'disbursed',
            onchainResult: { transactionHash: 'abc123' },
          },
        },
      ];

      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue(auditLogs);

      const result = await service.getStatusHistory(claimId);

      for (let i = 1; i < result.history.length; i++) {
        const prevTime = new Date(result.history[i - 1].timestamp).getTime();
        const currTime = new Date(result.history[i].timestamp).getTime();
        expect(currTime).toBeGreaterThanOrEqual(prevTime);
      }
    });

    it('queries auditLog with correct filters', async () => {
      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue([]);

      await service.getStatusHistory(claimId);

      expect(prismaService.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          entityId: claimId,
          entity: 'claim',
          action: { startsWith: 'status_changed_to_' },
        },
        orderBy: { timestamp: 'asc' },
      });
    });

    it('formats timestamps in ISO-8601 format with milliseconds', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          action: 'status_changed_to_verified',
          timestamp: new Date('2026-01-01T11:30:45.123Z'),
          metadata: { from: 'requested', to: 'verified' },
        },
      ];

      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue(auditLogs);

      const result = await service.getStatusHistory(claimId);

      expect(result.history[0].timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('identifies on-chain disbursement trigger correctly', async () => {
      const auditLogs = [
        {
          id: 'log-1',
          action: 'status_changed_to_disbursed',
          timestamp: new Date('2026-01-01T13:00:00Z'),
          metadata: {
            from: 'approved',
            to: 'disbursed',
            onchainResult: {
              transactionHash: 'abc123def456',
              status: 'confirmed',
            },
          },
        },
      ];

      prismaService.claim.findUnique.mockResolvedValue(mockClaim);
      prismaService.auditLog.findMany.mockResolvedValue(auditLogs);

      const result = await service.getStatusHistory(claimId);

      expect(result.history[0].actor).toBe('system');
      expect(result.history[0].trigger).toBe('on_chain_disbursement');
    });
  });
});
