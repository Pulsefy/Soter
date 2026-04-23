import { Test, TestingModule } from '@nestjs/testing';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';

describe('VerificationService - Review Workflow', () => {
  let service: VerificationService;
  let prismaService: PrismaService;
  let auditService: AuditService;

  const mockQueue = {
    add: jest.fn(),
    getWaitingCount: jest.fn(),
    getActiveCount: jest.fn(),
    getCompletedCount: jest.fn(),
    getFailedCount: jest.fn(),
  };

  const mockPrismaService = {
    claim: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockAuditService = {
    record: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        VERIFICATION_MODE: 'mock',
        VERIFICATION_THRESHOLD: '0.7',
        AI_SERVICE_URL: 'http://localhost:8000',
        AI_SERVICE_TIMEOUT_MS: '30000',
        OPENAI_MODEL: 'gpt-4o-mini',
      };
      return config[key];
    }),
  };

  const mockHttpService = {
    post: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        {
          provide: getQueueToken('verification'),
          useValue: mockQueue,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
    prismaService = module.get<PrismaService>(PrismaService);
    auditService = module.get<AuditService>(AuditService);

    jest.clearAllMocks();
  });

  describe('getReviewQueue', () => {
    it('should return paginated review queue', async () => {
      const mockClaims = [
        {
          id: 'claim1',
          status: 'requested',
          reviewStatus: 'pending_review',
          amount: 500,
          recipientRef: 'REF-001',
          verificationScore: 0.65,
          reviewSlaStartedAt: new Date('2025-01-20T10:00:00Z'),
          createdAt: new Date('2025-01-20T09:00:00Z'),
          campaign: {
            id: 'camp1',
            name: 'Emergency Relief',
          },
        },
      ];

      mockPrismaService.claim.findMany.mockResolvedValue(mockClaims);
      mockPrismaService.claim.count.mockResolvedValue(1);

      const result = await service.getReviewQueue('pending_review', 1, 20);

      expect(result).toEqual({
        data: mockClaims,
        total: 1,
        page: 1,
        limit: 20,
      });

      expect(mockPrismaService.claim.findMany).toHaveBeenCalledWith({
        where: {
          reviewStatus: 'pending_review',
          deletedAt: null,
        },
        skip: 0,
        take: 20,
        orderBy: [
          { reviewSlaStartedAt: 'asc' },
          { createdAt: 'asc' },
        ],
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    it('should return all reviews when no status filter provided', async () => {
      mockPrismaService.claim.findMany.mockResolvedValue([]);
      mockPrismaService.claim.count.mockResolvedValue(0);

      await service.getReviewQueue(undefined, 1, 20);

      expect(mockPrismaService.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
          },
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      mockPrismaService.claim.findMany.mockResolvedValue([]);
      mockPrismaService.claim.count.mockResolvedValue(50);

      const result = await service.getReviewQueue('pending_review', 3, 10);

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(mockPrismaService.claim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20, // (page 3 - 1) * 10
          take: 10,
        }),
      );
    });
  });

  describe('submitReview', () => {
    const mockClaim = {
      id: 'claim1',
      status: 'requested',
      reviewStatus: 'pending_review',
      amount: 500,
      verificationScore: 0.65,
    };

    it('should approve a claim and update status to verified', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrismaService.claim.update.mockResolvedValue({
        ...mockClaim,
        reviewStatus: 'approved',
        status: 'verified',
        reviewedBy: 'reviewer1',
        reviewReason: 'All documents verified',
      });

      const result = await service.submitReview(
        'claim1',
        'reviewer1',
        'approved',
        'All documents verified',
        'Internal note',
      );

      expect(mockPrismaService.claim.update).toHaveBeenCalledWith({
        where: { id: 'claim1' },
        data: {
          reviewStatus: 'approved',
          reviewedBy: 'reviewer1',
          reviewedAt: expect.any(Date),
          reviewReason: 'All documents verified',
          reviewNote: 'Internal note',
          status: 'verified',
        },
      });

      expect(mockAuditService.record).toHaveBeenCalledWith({
        actorId: 'reviewer1',
        entity: 'claim_review',
        entityId: 'claim1',
        action: 'approved',
        metadata: {
          reason: 'All documents verified',
          note: 'Internal note',
          previousStatus: 'requested',
          newStatus: 'verified',
        },
      });
    });

    it('should reject a claim and keep status as requested', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrismaService.claim.update.mockResolvedValue({
        ...mockClaim,
        reviewStatus: 'rejected',
        status: 'requested',
        reviewedBy: 'reviewer1',
        reviewReason: 'Insufficient evidence',
      });

      await service.submitReview(
        'claim1',
        'reviewer1',
        'rejected',
        'Insufficient evidence',
      );

      expect(mockPrismaService.claim.update).toHaveBeenCalledWith({
        where: { id: 'claim1' },
        data: {
          reviewStatus: 'rejected',
          reviewedBy: 'reviewer1',
          reviewedAt: expect.any(Date),
          reviewReason: 'Insufficient evidence',
          reviewNote: undefined,
          status: 'requested',
        },
      });

      expect(mockAuditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rejected',
        }),
      );
    });

    it('should throw NotFoundException when claim does not exist', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(null);

      await expect(
        service.submitReview(
          'nonexistent',
          'reviewer1',
          'approved',
          'reason',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.claim.update).not.toHaveBeenCalled();
      expect(mockAuditService.record).not.toHaveBeenCalled();
    });

    it('should handle review without internal note', async () => {
      mockPrismaService.claim.findUnique.mockResolvedValue(mockClaim);
      mockPrismaService.claim.update.mockResolvedValue({
        ...mockClaim,
        reviewStatus: 'approved',
      });

      await service.submitReview(
        'claim1',
        'reviewer1',
        'approved',
        'Approved',
      );

      expect(mockPrismaService.claim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewNote: undefined,
          }),
        }),
      );
    });
  });
});
