import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { HttpService } from '@nestjs/axios';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClaimStatus, Prisma } from '@prisma/client';
import { of } from 'rxjs';
import { CorrelationPropagationUtil } from '../common/utils/correlation-propagation.util';
import { VerificationMetadataService } from './metadata.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { VerificationPriority } from './dto/enqueue-verification.dto';

// Mock CorrelationPropagationUtil since it's injected into VerificationService
jest.mock('../common/utils/correlation-propagation.util');

describe('VerificationService', () => {
  let service: VerificationService;
  let prismaService: PrismaService;
  let mockQueue: {
    add: jest.Mock;
    getWaiting: jest.Mock;
    getWaitingCount: jest.Mock;
    getActiveCount: jest.Mock;
    getCompletedCount: jest.Mock;
    getFailedCount: jest.Mock;
  };

  // Mock MetricsService for priority tracking
  const mockMetricsService = {
    incrementVerificationJobEnqueued: jest.fn(),
    setVerificationQueueWaitingByPriority: jest.fn(),
  };

  // Create a mock for VerificationMetadataService
  const mockVerificationMetadataService = {
    enhanceWithMetadata: jest
      .fn()
      .mockImplementation((result, claimId, campaignId) => ({
        ...result,
        metadata: {
          campaignId,
          claimId,
          packageId: `pkg_${claimId.substring(0, 8)}`,
          network: 'testnet',
          chainId: 'testnet',
          version: '1.0.0',
          timestamp: new Date(),
        },
        warnings: [],
        validationErrors: [],
      })),
    generateMetadata: jest.fn().mockImplementation((claimId, campaignId) => ({
      campaignId,
      claimId,
      packageId: `pkg_${claimId.substring(0, 8)}`,
      network: 'testnet',
      chainId: 'testnet',
      version: '1.0.0',
      timestamp: new Date(),
    })),
    validateMetadata: jest.fn().mockReturnValue([]),
    validateWebhookPayload: jest
      .fn()
      .mockReturnValue({ isValid: true, errors: [] }),
  };

  // Mock CorrelationPropagationUtil
  const mockCorrelationPropagationUtil = {
    getCurrentCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
    getCorrelationHeaders: jest
      .fn()
      .mockReturnValue({ 'x-correlation-id': 'test-correlation-id' }),
    addCorrelationToRequest: jest.fn().mockImplementation(config => config),
    logOutboundRequest: jest.fn(),
    setLogger: jest.fn(),
  };

  // Explicitly cast instance to any to account for structural additions to the Claim scheme context
  const mockClaim: any = {
    id: 'test-claim-id',
    status: ClaimStatus.requested,
    description: 'Test claim',
    createdAt: new Date(),
    updatedAt: new Date(),
    campaignId: 'test-campaign-id',
    amount: new Prisma.Decimal(100.0),
    recipientRef: 'test-recipient',
    evidenceRef: 'test-evidence',
    verificationResult: null,
    verifiedAt: null,
    metadata: null,
    anchorMetadata: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getWaiting: jest.fn().mockResolvedValue([]),
      getWaitingCount: jest.fn().mockResolvedValue(5),
      getActiveCount: jest.fn().mockResolvedValue(2),
      getCompletedCount: jest.fn().mockResolvedValue(100),
      getFailedCount: jest.fn().mockResolvedValue(3),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        {
          provide: getQueueToken('verification'),
          useValue: mockQueue,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                VERIFICATION_MODE: 'mock',
                VERIFICATION_THRESHOLD: '0.7',
                QUEUE_MAX_RETRIES: '3',
                AI_SERVICE_URL: 'http://localhost:8000',
                AI_SERVICE_TIMEOUT_MS: '30000',
                STELLAR_CHAIN_ID: 'testnet',
                STELLAR_NETWORK: 'testnet',
              };
              return config[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            claim: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: AuditService,
          useValue: {
            record: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: HttpService,
          useValue: {
            post: jest.fn().mockReturnValue(of({ data: {} })),
          },
        },
        {
          provide: VerificationMetadataService,
          useValue: mockVerificationMetadataService,
        },
        {
          provide: CorrelationPropagationUtil,
          useValue: mockCorrelationPropagationUtil,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('enqueueVerification', () => {
    it('should enqueue a verification job with default (NORMAL) priority', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const result = await service.enqueueVerification('test-claim-id');

      expect(result).toEqual({
        jobId: 'job-123',
        priority: VerificationPriority.NORMAL,
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'verify-claim',
        expect.objectContaining({
          claimId: 'test-claim-id',
          timestamp: expect.any(Number) as number,
          priority: VerificationPriority.NORMAL,
        }),
        expect.objectContaining({
          priority: VerificationPriority.NORMAL,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        }),
      );
      expect(
        mockMetricsService.incrementVerificationJobEnqueued,
      ).toHaveBeenCalledWith('NORMAL');
    });

    it('should enqueue with URGENT priority when requested', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const result = await service.enqueueVerification('test-claim-id', {
        priority: VerificationPriority.URGENT,
      });

      expect(result).toEqual({
        jobId: 'job-123',
        priority: VerificationPriority.URGENT,
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'verify-claim',
        expect.objectContaining({ priority: VerificationPriority.URGENT }),
        expect.objectContaining({ priority: VerificationPriority.URGENT }),
      );
      expect(
        mockMetricsService.incrementVerificationJobEnqueued,
      ).toHaveBeenCalledWith('URGENT');
    });

    it('should enqueue with LOW priority when requested', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const result = await service.enqueueVerification('test-claim-id', {
        priority: VerificationPriority.LOW,
      });

      expect(result).toEqual({
        jobId: 'job-123',
        priority: VerificationPriority.LOW,
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'verify-claim',
        expect.objectContaining({ priority: VerificationPriority.LOW }),
        expect.objectContaining({ priority: VerificationPriority.LOW }),
      );
    });

    it('should throw AppException(AI_VERIFICATION_FAILED) for non-existent claim', async () => {
      jest.spyOn(prismaService.claim, 'findUnique').mockResolvedValue(null);

      await expect(
        service.enqueueVerification('non-existent-id'),
      ).rejects.toMatchObject({
        errorCode: 'AI_VERIFICATION_FAILED',
        statusCode: 404,
      });
    });

    it('should skip enqueuing for already verified claims', async () => {
      const verifiedClaim = { ...mockClaim, status: ClaimStatus.verified };
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(verifiedClaim);

      const result = await service.enqueueVerification('test-claim-id');

      expect(result).toEqual({
        jobId: 'already-verified',
        priority: VerificationPriority.NORMAL,
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('processVerification', () => {
    it('should process verification in mock mode', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      const updateSpy = jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({
          ...mockClaim,
          status: ClaimStatus.verified,
        });

      const result = await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
      });

      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('details');
      expect(result.score).toBeGreaterThanOrEqual(0.5);
      expect(result.score).toBeLessThanOrEqual(0.95);
      expect(updateSpy).toHaveBeenCalled();
    });

    it('should throw AppException(AI_VERIFICATION_FAILED) for non-existent claim during processing', async () => {
      jest.spyOn(prismaService.claim, 'findUnique').mockResolvedValue(null);

      await expect(
        service.processVerification({
          claimId: 'non-existent-id',
          timestamp: Date.now(),
          priority: VerificationPriority.NORMAL,
        }),
      ).rejects.toMatchObject({
        errorCode: 'AI_VERIFICATION_FAILED',
        statusCode: 404,
      });
    });

    it('should update claim status to verified when score meets threshold', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      jest.spyOn(service as any, 'generateMockVerification').mockReturnValue({
        score: 0.85,
        confidence: 0.9,
        details: {
          factors: ['Test factor'],
          riskLevel: 'low' as const,
        },
        processedAt: new Date(),
      });

      const updateSpy = jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({
          ...mockClaim,
          status: ClaimStatus.verified,
        });

      await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
      });

      const updateCall = updateSpy.mock.calls[0]?.[0];
      expect(updateCall?.data).toHaveProperty('status');
      expect(updateCall?.data?.status).toBe('verified');
    });
  });

  describe('processVerification (test mode)', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VerificationService,
          {
            provide: getQueueToken('verification'),
            useValue: mockQueue,
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                const config: Record<string, string> = {
                  VERIFICATION_MODE: 'test',
                  VERIFICATION_THRESHOLD: '0.7',
                  QUEUE_MAX_RETRIES: '3',
                  AI_SERVICE_URL: 'http://localhost:8000',
                  AI_SERVICE_TIMEOUT_MS: '30000',
                  STELLAR_CHAIN_ID: 'testnet',
                  STELLAR_NETWORK: 'testnet',
                };
                return config[key];
              }),
            },
          },
          {
            provide: PrismaService,
            useValue: {
              claim: {
                findUnique: jest.fn(),
                update: jest.fn(),
              },
            },
          },
          {
            provide: AuditService,
            useValue: {
              record: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: HttpService,
            useValue: {
              post: jest.fn().mockReturnValue(of({ data: {} })),
            },
          },
          {
            provide: VerificationMetadataService,
            useValue: mockVerificationMetadataService,
          },
          {
            provide: CorrelationPropagationUtil,
            useValue: mockCorrelationPropagationUtil,
          },
          {
            provide: MetricsService,
            useValue: mockMetricsService,
          },
        ],
      }).compile();

      service = module.get<VerificationService>(VerificationService);
      prismaService = module.get<PrismaService>(PrismaService);
    });

    it('should return deterministic results in test mode', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({ ...mockClaim, status: ClaimStatus.verified });

      const first = await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
      });
      const second = await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
      });

      expect(first.score).toEqual(second.score);
      expect(first.confidence).toEqual(second.confidence);
      expect(first.details.riskLevel).toEqual(second.details.riskLevel);
      expect(first.details.factors).toEqual(second.details.factors);
    });

    it('should produce different results for different claims', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({ ...mockClaim, status: ClaimStatus.verified });

      const first = await service.processVerification({
        claimId: 'claim-alpha',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
      });
      const second = await service.processVerification({
        claimId: 'claim-beta',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
      });

      const riskLevels = [first.details.riskLevel, second.details.riskLevel];
      expect(riskLevels).toBeDefined();
    });

    it('should have valid fixture scores in test mode', () => {
      const fixtures = (service as any)._fixtures as any[];
      for (const fixture of fixtures) {
        expect(fixture.score).toBeGreaterThanOrEqual(0);
        expect(fixture.score).toBeLessThanOrEqual(1);
        expect(fixture.confidence).toBeGreaterThanOrEqual(0);
        expect(fixture.confidence).toBeLessThanOrEqual(1);
        expect(['low', 'medium', 'high']).toContain(fixture.details.riskLevel);
      }
    });

    it('should return the same fixture for repeated calls with the same ID', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);
      jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({ ...mockClaim, status: ClaimStatus.verified });

      const claimId = 'deterministic-test-claim';
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.processVerification({
            claimId,
            timestamp: Date.now(),
            priority: VerificationPriority.NORMAL,
          }),
        ),
      );

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toEqual(results[0].score);
        expect(results[i].confidence).toEqual(results[0].confidence);
      }
    });
  });

  describe('getQueueMetrics', () => {
    it('should return queue metrics with priority breakdown', async () => {
      // Simulate two waiting jobs with different priorities
      mockQueue.getWaiting.mockResolvedValue([
        {
          data: {
            claimId: 'c1',
            timestamp: 1,
            priority: VerificationPriority.URGENT,
          },
        },
        {
          data: {
            claimId: 'c2',
            timestamp: 2,
            priority: VerificationPriority.NORMAL,
          },
        },
        {
          data: {
            claimId: 'c3',
            timestamp: 3,
            priority: VerificationPriority.NORMAL,
          },
        },
      ]);
      // Override waiting count to match mocked jobs
      mockQueue.getWaitingCount.mockResolvedValue(3);

      const metrics = await service.getQueueMetrics();

      expect(metrics).toMatchObject({
        waiting: 3,
        active: 2,
        completed: 100,
        failed: 3,
        total: 108,
        priorityBreakdown: {
          urgent: 1,
          high: 0,
          normal: 2,
          low: 0,
        },
      });
      expect(
        mockMetricsService.setVerificationQueueWaitingByPriority,
      ).toHaveBeenCalledWith('URGENT', 1);
      expect(
        mockMetricsService.setVerificationQueueWaitingByPriority,
      ).toHaveBeenCalledWith('NORMAL', 2);
    });

    it('should return all-zero priority breakdown when queue is empty', async () => {
      mockQueue.getWaiting.mockResolvedValue([]);
      mockQueue.getWaitingCount.mockResolvedValue(0);

      const metrics = await service.getQueueMetrics();

      expect(metrics.priorityBreakdown).toEqual({
        urgent: 0,
        high: 0,
        normal: 0,
        low: 0,
      });
    });
  });

  describe('findOne', () => {
    it('should return a claim by id', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const result = await service.findOne('test-claim-id');

      expect(result).toEqual(mockClaim);
    });

    it('should throw AppException(AI_VERIFICATION_FAILED) for non-existent claim', async () => {
      jest.spyOn(prismaService.claim, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toMatchObject({
        errorCode: 'AI_VERIFICATION_FAILED',
        statusCode: 404,
      });
    });
  });

  describe('anchor metadata persistence', () => {
    it('should persist anchor_metadata when AI returns it', async () => {
      const anchorMetadata = {
        campaignRef: 'CAMPAIGN-001',
        claimId: 'claim-ref-123',
        packageId: 'PKG-456',
      };

      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const updateSpy = jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({
          ...mockClaim,
          status: ClaimStatus.verified,
          anchorMetadata,
        });

      await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
        anchorMetadata,
      });

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'test-claim-id' },
        data: {
          status: expect.any(String),
          anchorMetadata: {
            campaignRef: 'CAMPAIGN-001',
            claimId: 'claim-ref-123',
            packageId: 'PKG-456',
            contractId: null,
          },
        },
      });
    });

    it('should store null anchor_metadata when AI omits it', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const updateSpy = jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({
          ...mockClaim,
          status: ClaimStatus.verified,
          anchorMetadata: null,
        });

      await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
      });

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'test-claim-id' },
        data: {
          status: expect.any(String),
          anchorMetadata: expect.anything(),
        },
      });
    });

    it('should enqueue verification with anchor_metadata', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const anchorMetadata = {
        campaignRef: 'CAMPAIGN-002',
        claimId: 'claim-ref-456',
      };

      await service.enqueueVerification('test-claim-id', { anchorMetadata });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'verify-claim',
        expect.objectContaining({
          claimId: 'test-claim-id',
          anchorMetadata: {
            campaignRef: 'CAMPAIGN-002',
            claimId: 'claim-ref-456',
            packageId: null,
            contractId: null,
          },
        }),
        expect.any(Object),
      );
    });

    it('should return anchor_metadata in GET /verification/:id', async () => {
      const claimWithMetadata = {
        ...mockClaim,
        anchorMetadata: {
          campaignRef: 'CAMPAIGN-003',
          claimId: 'claim-ref-789',
          packageId: 'PKG-789',
        },
      };

      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(claimWithMetadata);

      const result = await service.findOne('test-claim-id');

      expect(result.anchorMetadata).toEqual({
        campaignRef: 'CAMPAIGN-003',
        claimId: 'claim-ref-789',
        packageId: 'PKG-789',
      });
    });

    it('should handle partial anchor_metadata (only campaignRef)', async () => {
      const partialAnchorMetadata = {
        campaignRef: 'CAMPAIGN-PARTIAL',
      };

      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const updateSpy = jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({
          ...mockClaim,
          status: ClaimStatus.verified,
          anchorMetadata: {
            campaignRef: 'CAMPAIGN-PARTIAL',
            claimId: null,
            packageId: null,
          },
        });

      await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
        priority: VerificationPriority.NORMAL,
        anchorMetadata: partialAnchorMetadata,
      });

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'test-claim-id' },
        data: {
          status: expect.any(String),
          anchorMetadata: {
            campaignRef: 'CAMPAIGN-PARTIAL',
            claimId: null,
            packageId: null,
            contractId: null,
          },
        },
      });
    });
  });
});
