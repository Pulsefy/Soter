import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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

  const mockClaim = {
    id: 'test-claim-id',
    status: 'pending',
    description: 'Test claim',
    createdAt: new Date(),
    updatedAt: new Date(),
    verificationScore: null,
    verificationResult: null,
    verifiedAt: null,
    metadata: null,
  };

  beforeEach(async () => {
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
      const verifiedClaim = { ...mockClaim, status: 'verified' };
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
          status: 'verified',
          verificationScore: 0.85,
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
          riskLevel: 'low',
        },
        processedAt: new Date(),
      });

      const updateSpy = jest
        .spyOn(prismaService.claim, 'update')
        .mockResolvedValue({
          ...mockClaim,
          status: 'verified',
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
});
