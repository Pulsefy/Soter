import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { VerificationProcessor } from './verification.processor';
import { VerificationService } from './verification.service';
import {
  VerificationJobData,
  VerificationResult,
} from './interfaces/verification-job.interface';

describe('VerificationProcessor', () => {
  let processor: VerificationProcessor;
  let verificationService: VerificationService;

  const mockJobData: VerificationJobData = {
    claimId: 'test-claim-id',
    timestamp: Date.now(),
  };

  const mockResult: VerificationResult = {
    score: 0.85,
    confidence: 0.92,
    details: {
      factors: ['Document authenticity verified'],
      riskLevel: 'low',
    },
    processedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationProcessor,
        {
          provide: VerificationService,
          useValue: {
            processVerification: jest.fn().mockResolvedValue(mockResult),
          },
        },
      ],
    }).compile();

    processor = module.get<VerificationProcessor>(VerificationProcessor);
    verificationService = module.get<VerificationService>(VerificationService);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should process a verification job successfully', async () => {
      const mockJob = {
        id: 'job-123',
        data: mockJobData,
        attemptsMade: 0,
      } as Job<VerificationJobData, VerificationResult, string>;

      const result = await processor.process(mockJob);

      expect(result).toEqual(mockResult);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(verificationService.processVerification).toHaveBeenCalledWith(
        mockJobData,
      );
    });

    it('should throw error when processing fails', async () => {
      const mockJob = {
        id: 'job-123',
        data: mockJobData,
        attemptsMade: 0,
      } as Job<VerificationJobData, VerificationResult, string>;

      const error = new Error('Processing failed');
      jest
        .spyOn(verificationService, 'processVerification')
        .mockRejectedValue(error);

      await expect(processor.process(mockJob)).rejects.toThrow(
        'Processing failed',
      );
    });
  });

  describe('event handlers', () => {
    it('should handle completed event', () => {
      const mockJob = {
        id: 'job-123',
        data: mockJobData,
      } as Job<VerificationJobData, VerificationResult>;

      expect(() => processor.onCompleted(mockJob)).not.toThrow();
    });

    it('should handle failed event with job', () => {
      const mockJob = {
        id: 'job-123',
        data: mockJobData,
      } as Job<VerificationJobData>;

      const error = new Error('Test error');

      expect(() => processor.onFailed(mockJob, error)).not.toThrow();
    });

    it('should handle failed event without job', () => {
      const error = new Error('Test error');

      expect(() => processor.onFailed(undefined, error)).not.toThrow();
    });

    it('should handle active event', () => {
      const mockJob = {
        id: 'job-123',
        data: mockJobData,
      } as Job<VerificationJobData>;

      expect(() => processor.onActive(mockJob)).not.toThrow();
    });

    it('should handle stalled event', () => {
      expect(() => processor.onStalled('job-123')).not.toThrow();
    });

    it('should handle progress event', () => {
      const mockJob = {
        id: 'job-123',
        data: mockJobData,
      } as Job<VerificationJobData>;

      expect(() => processor.onProgress(mockJob, 50)).not.toThrow();
    });
  });
});
