import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { SessionService } from '../session/session.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiVerificationPayloadDto,
  VerificationStatus,
} from './dto/ai-verification.dto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SessionStatus, StepStatus } from '@prisma/client';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: PrismaService;
  let sessionService: SessionService;

  const mockPrisma = {
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(callback => callback(mockPrisma)),
  };

  const mockSessionService = {
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
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prisma = module.get<PrismaService>(PrismaService);
    sessionService = module.get<SessionService>(SessionService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processAiVerification', () => {
    it('should throw ConflictException if event is already processed', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue({ id: '1' });

      await expect(service.processAiVerification(payload)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if session is not found or not active', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockSessionService.getSession.mockResolvedValue(null);

      await expect(service.processAiVerification(payload)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if a suitable step is not found', async () => {
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockSessionService.getSession.mockResolvedValue({
        id: 'sess_456',
        status: SessionStatus.pending,
        steps: [{ stepName: 'other_step', status: StepStatus.pending }],
      });

      await expect(service.processAiVerification(payload)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should process the webhook successfully', async () => {
      const stepId = 'step_789';
      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockSessionService.getSession.mockResolvedValue({
        id: 'sess_456',
        status: SessionStatus.pending,
        steps: [
          {
            id: stepId,
            stepName: 'identity_verification',
            status: StepStatus.in_progress,
          },
        ],
      });

      const result = await service.processAiVerification(payload);

      expect(prisma.webhookEvent.create).toHaveBeenCalled();
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
