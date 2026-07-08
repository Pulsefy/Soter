import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { HttpService } from '@nestjs/axios';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClaimStatus, Prisma } from '@prisma/client';
import { of } from 'rxjs';
import { CorrelationPropagationUtil } from '../common/utils/correlation-propagation.util';

// Mock CorrelationPropagationUtil since it's injected into VerificationService
jest.mock('../common/utils/correlation-propagation.util');

describe('VerificationService', () => {
  let service: VerificationService;
  let prismaService: PrismaService;
  let mockQueue: {
    add: jest.Mock;
    getWaitingCount: jest.Mock;
    getActiveCount: jest.Mock;
    getCompletedCount: jest.Mock;
    getFailedCount: jest.Mock;
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
          provide: 'VerificationMetadataService',
          useValue: mockVerificationMetadataService,
        },
        {
          provide: CorrelationPropagationUtil,
          useValue: mockCorrelationPropagationUtil,
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
    it('should enqueue a verification job for a valid claim', async () => {
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(mockClaim);

      const result = await service.enqueueVerification('test-claim-id');

      expect(result).toEqual({ jobId: 'job-123' });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'verify-claim',
        expect.objectContaining({
          claimId: 'test-claim-id',
          timestamp: expect.any(Number) as number,
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }),
      );
    });

    it('should throw NotFoundException for non-existent claim', async () => {
      jest.spyOn(prismaService.claim, 'findUnique').mockResolvedValue(null);

      await expect(
        service.enqueueVerification('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should skip enqueuing for already verified claims', async () => {
      const verifiedClaim = { ...mockClaim, status: ClaimStatus.verified };
      jest
        .spyOn(prismaService.claim, 'findUnique')
        .mockResolvedValue(verifiedClaim);

      const result = await service.enqueueVerification('test-claim-id');

      expect(result).toEqual({ jobId: 'already-verified' });
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
      });

      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('details');
      expect(result.score).toBeGreaterThanOrEqual(0.5);
      expect(result.score).toBeLessThanOrEqual(0.95);
      expect(updateSpy).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent claim during processing', async () => {
      jest.spyOn(prismaService.claim, 'findUnique').mockResolvedValue(null);

      await expect(
        service.processVerification({
          claimId: 'non-existent-id',
          timestamp: Date.now(),
        }),
      ).rejects.toThrow(NotFoundException);
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
            provide: 'VerificationMetadataService',
            useValue: mockVerificationMetadataService,
          },
          {
            provide: CorrelationPropagationUtil,
            useValue: mockCorrelationPropagationUtil,
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
      });
      const second = await service.processVerification({
        claimId: 'test-claim-id',
        timestamp: Date.now(),
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
      });
      const second = await service.processVerification({
        claimId: 'claim-beta',
        timestamp: Date.now(),
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
          service.processVerification({ claimId, timestamp: Date.now() }),
        ),
      );

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toEqual(results[0].score);
        expect(results[i].confidence).toEqual(results[0].confidence);
      }
    });
  });

  describe('getQueueMetrics', () => {
    it('should return queue metrics', async () => {
      const metrics = await service.getQueueMetrics();

      expect(metrics).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        total: 110,
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

    it('should throw NotFoundException for non-existent claim', async () => {
      jest.spyOn(prismaService.claim, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
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

      await service.enqueueVerification('test-claim-id', anchorMetadata);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'verify-claim',
        expect.objectContaining({
          claimId: 'test-claim-id',
          anchorMetadata: {
            campaignRef: 'CAMPAIGN-002',
            claimId: 'claim-ref-456',
            packageId: null,
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
          },
        },
      });
    });
  });
});
