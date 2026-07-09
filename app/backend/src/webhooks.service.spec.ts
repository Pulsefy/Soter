import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { SessionService } from './session/session.service';
import { PrismaService } from './prisma/prisma.service';
import {
  AiVerificationPayloadDto,
  VerificationStatus,
} from './ai-verification.dto';
import { ConflictException, NotFoundException } from '@nestjs/common';

jest.mock('@prisma/client', () => {
  return {
    ...jest.requireActual('@prisma/client'),
    SessionStatus: {
      pending: 'pending',
      approved: 'approved',
      disbursed: 'disbursed',
    },
    StepStatus: {
      pending: 'pending',
      in_progress: 'in_progress',
      completed: 'completed',
      failed: 'failed',
    },
  };
});

// Define the mock Prisma type for better type safety
type MockPrismaService = {
  webhookEvent: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

describe('WebhooksService', () => {
  let service: WebhooksService;
  // _prisma is intentionally unused - kept for potential future use
  let _prisma: PrismaService;
  let sessionService: SessionService;

  // Use type assertion for the mock
  const mockPrisma = {
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(callback => callback(mockPrisma)),
  } as unknown as MockPrismaService;

  const mockSessionServiceObj = {
    getSession: jest.fn(),
    submitToStep: jest.fn(),
  };

  const payload: AiVerificationPayloadDto = {
    eventId: 'evt_123',
    sessionId: 'sess_456',
    status: VerificationStatus.VERIFIED,
    details: { score: 0.9 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: PrismaService,
          useValue: mockPrisma as unknown as PrismaService,
        },
        { provide: SessionService, useValue: mockSessionServiceObj },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    _prisma = module.get<PrismaService>(PrismaService);
    sessionService = module.get<SessionService>(SessionService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processAiVerification', () => {
    it('should throw ConflictException if event is already processed', async () => {
      // Use type assertion to access the mocked property
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({
        id: '1',
      });

      await expect(service.processAiVerification(payload)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if session is not found or not active', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockSessionServiceObj.getSession.mockResolvedValue(null);

      await expect(service.processAiVerification(payload)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if a suitable step is not found', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockSessionServiceObj.getSession.mockResolvedValue({
        id: 'sess_456',
        status: 'pending',
        steps: [{ stepName: 'other_step', status: 'pending' }],
      });

      await expect(service.processAiVerification(payload)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should process the webhook successfully', async () => {
      const stepId = 'step_789';
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockSessionServiceObj.getSession.mockResolvedValue({
        id: 'sess_456',
        status: 'pending',
        steps: [
          {
            id: stepId,
            stepName: 'identity_verification',
            status: 'in_progress',
          },
        ],
      });

      const result = await service.processAiVerification(payload);

      // Use type assertion for the expectation
      expect(mockPrisma.webhookEvent.create).toHaveBeenCalled();
      expect(sessionService.submitToStep).toHaveBeenCalledWith(
        payload.sessionId,
        stepId,
        {
          submissionKey: payload.eventId,
          payload: { status: payload.status, details: payload.details },
        },
      );
      expect(result).toEqual({ status: 'success', eventId: payload.eventId });
    });
  });
});
