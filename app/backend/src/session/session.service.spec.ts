import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SessionType,
  VerificationSessionStatus,
  SessionStepStatus,
} from '@prisma/client';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

describe('SessionService', () => {
  let service: SessionService;

  const mockPrismaService = {
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    sessionStep: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    sessionSubmission: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a simple session without steps', async () => {
      const createDto = {
        type: SessionType.otp_verification,
        contextId: 'user123',
        metadata: { channel: 'email' },
      };

      const mockSession = {
        id: 'session123',
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'user123',
        metadata: { channel: 'email' },
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [],
        submissions: [],
      };

      mockPrismaService.session.create.mockResolvedValue(mockSession);

      const result = await service.createSession(createDto);

      expect(result.id).toBe('session123');
      expect(result.type).toBe(SessionType.otp_verification);
      expect(result.status).toBe(VerificationSessionStatus.pending);
      expect(mockPrismaService.session.create).toHaveBeenCalledWith({
        data: {
          type: SessionType.otp_verification,
          contextId: 'user123',
          metadata: { channel: 'email' },
          expiresAt: null,
          steps: undefined,
        },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          submissions: true,
        },
      });
    });

    it('should create a multi-step session', async () => {
      const createDto = {
        type: SessionType.multi_step_verification,
        contextId: 'claim456',
        steps: [
          { stepName: 'document_upload', stepOrder: 1, maxAttempts: 3 },
          { stepName: 'identity_verification', stepOrder: 2, maxAttempts: 2 },
        ],
      };

      const mockSession = {
        id: 'session456',
        type: SessionType.multi_step_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'claim456',
        metadata: {},
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [
          {
            id: 'step1',
            stepName: 'document_upload',
            stepOrder: 1,
            status: SessionStepStatus.pending,
            input: {},
            output: null,
            error: null,
            attempts: 0,
            maxAttempts: 3,
            startedAt: null,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'step2',
            stepName: 'identity_verification',
            stepOrder: 2,
            status: SessionStepStatus.pending,
            input: {},
            output: null,
            error: null,
            attempts: 0,
            maxAttempts: 2,
            startedAt: null,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        submissions: [],
      };

      mockPrismaService.session.create.mockResolvedValue(mockSession);

      const result = await service.createSession(createDto);

      expect(result.steps).toHaveLength(2);
      expect(result.steps![0].stepName).toBe('document_upload');
      expect(result.steps![1].stepName).toBe('identity_verification');
      expect(result.currentStep?.stepName).toBe('document_upload');
    });

    it('should reject session with past expiration time', async () => {
      const pastDate = new Date(Date.now() - 1000);
      const createDto = {
        type: SessionType.otp_verification,
        expiresAt: pastDate.toISOString(),
      };

      await expect(service.createSession(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getSession', () => {
    it('should return session with steps', async () => {
      const mockSession = {
        id: 'session123',
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'user123',
        metadata: {},
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [],
        submissions: [],
      };

      mockPrismaService.session.findUnique.mockResolvedValue(mockSession);

      const result = await service.getSession('session123');

      expect(result.id).toBe('session123');
      expect(mockPrismaService.session.findUnique).toHaveBeenCalledWith({
        where: { id: 'session123' },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          submissions: true,
        },
      });
    });

    it('should throw NotFoundException for non-existent session', async () => {
      mockPrismaService.session.findUnique.mockResolvedValue(null);

      await expect(service.getSession('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should auto-expire session if past expiration time', async () => {
      const expiredSession = {
        id: 'session123',
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'user123',
        metadata: {},
        expiresAt: new Date(Date.now() - 1000), // Past expiration
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [],
        submissions: [],
      };

      mockPrismaService.session.findUnique.mockResolvedValue(expiredSession);
      mockPrismaService.session.update.mockResolvedValue({
        ...expiredSession,
        status: VerificationSessionStatus.expired,
      });

      const result = await service.getSession('session123');

      expect(result.status).toBe(VerificationSessionStatus.expired);
      expect(mockPrismaService.session.update).toHaveBeenCalledWith({
        where: { id: 'session123' },
        data: { status: VerificationSessionStatus.expired },
      });
    });
  });

  describe('submitToStep', () => {
    const mockStep = {
      id: 'step1',
      sessionId: 'session123',
      stepName: 'otp_validation',
      stepOrder: 1,
      status: SessionStepStatus.pending,
      input: {},
      output: null,
      error: null,
      attempts: 0,
      maxAttempts: 3,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockSession = {
      id: 'session123',
      type: SessionType.otp_verification,
      status: VerificationSessionStatus.pending,
      contextId: 'user123',
      metadata: {},
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      failedAt: null,
      steps: [mockStep],
      submissions: [],
    };

    it('should handle idempotent submissions', async () => {
      const submitDto = {
        submissionKey: 'unique-key-123',
        payload: { code: '123456', expectedCode: '123456' },
      };

      const existingSubmission = {
        id: 'submission123',
        sessionId: 'session123',
        stepId: 'step1',
        submissionKey: 'unique-key-123',
        payload: submitDto.payload,
        response: { success: true },
        createdAt: new Date(),
      };

      mockPrismaService.sessionSubmission.findUnique.mockResolvedValue(
        existingSubmission,
      );

      const result = await service.submitToStep(
        'session123',
        'step1',
        submitDto,
      );

      expect(result.isIdempotent).toBe(true);
      expect(result.submissionKey).toBe('unique-key-123');
      expect(mockPrismaService.sessionSubmission.create).not.toHaveBeenCalled();
    });

    it('should process new submission successfully', async () => {
      const submitDto = {
        submissionKey: 'unique-key-456',
        payload: { code: '123456', expectedCode: '123456' },
      };

      // Mock no existing submission
      mockPrismaService.sessionSubmission.findUnique.mockResolvedValue(null);

      // Mock getSession call - return session with pending step
      const sessionWithPendingStep = {
        id: 'session123',
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'user123',
        metadata: {},
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [{ ...mockStep, status: SessionStepStatus.pending }],
        submissions: [],
      };

      // Mock the session.findUnique calls (for getSession and completion check)
      mockPrismaService.session.findUnique
        .mockResolvedValueOnce(sessionWithPendingStep) // First call in getSession
        .mockResolvedValueOnce({
          // Second call in checkSessionCompletion
          ...sessionWithPendingStep,
          steps: [{ ...mockStep, status: SessionStepStatus.completed }],
        });

      // Mock step lookup and updates
      mockPrismaService.sessionStep.findUnique.mockResolvedValue({
        ...mockStep,
        status: SessionStepStatus.pending,
      });
      mockPrismaService.sessionStep.update
        .mockResolvedValueOnce({
          ...mockStep,
          status: SessionStepStatus.in_progress,
          startedAt: new Date(),
        })
        .mockResolvedValueOnce({ ...mockStep, attempts: 1 })
        .mockResolvedValueOnce({
          ...mockStep,
          status: SessionStepStatus.completed,
          completedAt: new Date(),
        });

      // Mock session completion update
      mockPrismaService.session.update.mockResolvedValue({
        ...sessionWithPendingStep,
        status: VerificationSessionStatus.completed,
      });

      // Mock submission creation
      const newSubmission = {
        id: 'submission456',
        sessionId: 'session123',
        stepId: 'step1',
        submissionKey: 'unique-key-456',
        payload: submitDto.payload,
        response: {
          success: true,
          validated: true,
          timestamp: expect.any(String),
        },
        createdAt: new Date(),
      };
      mockPrismaService.sessionSubmission.create.mockResolvedValue(
        newSubmission,
      );

      const result = await service.submitToStep(
        'session123',
        'step1',
        submitDto,
      );

      expect(result.isIdempotent).toBe(false);
      expect(result.submissionKey).toBe('unique-key-456');
      expect(result.response?.success).toBe(true);
    });

    it('should reject submission to completed step', async () => {
      const submitDto = {
        submissionKey: 'unique-key-789',
        payload: { code: '123456' },
      };

      const completedStep = {
        ...mockStep,
        status: SessionStepStatus.completed,
      };

      const sessionWithCompletedStep = {
        ...mockSession,
        steps: [completedStep],
      };

      mockPrismaService.sessionSubmission.findUnique.mockResolvedValue(null);
      mockPrismaService.session.findUnique.mockResolvedValue(
        sessionWithCompletedStep,
      );

      await expect(
        service.submitToStep('session123', 'step1', submitDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should handle step failure and retry logic', async () => {
      const submitDto = {
        submissionKey: 'unique-key-fail',
        payload: { code: '123456', expectedCode: '654321' }, // Wrong code
      };

      const stepWithAttempts = {
        ...mockStep,
        attempts: 2, // Near max attempts
        status: SessionStepStatus.pending,
      };

      const sessionWithPendingStep = {
        id: 'session123',
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'user123',
        metadata: {},
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [stepWithAttempts],
        submissions: [],
      };

      mockPrismaService.sessionSubmission.findUnique.mockResolvedValue(null);
      mockPrismaService.session.findUnique.mockResolvedValue(
        sessionWithPendingStep,
      );
      mockPrismaService.sessionStep.findUnique.mockResolvedValue(
        stepWithAttempts,
      );

      // Mock step updates for failure
      mockPrismaService.sessionStep.update
        .mockResolvedValueOnce({
          ...stepWithAttempts,
          status: SessionStepStatus.in_progress,
        })
        .mockResolvedValueOnce({ ...stepWithAttempts, attempts: 3 }) // Max attempts reached
        .mockResolvedValueOnce({
          ...stepWithAttempts,
          status: SessionStepStatus.failed,
        });

      // Mock session failure
      mockPrismaService.session.update.mockResolvedValue({
        ...sessionWithPendingStep,
        status: VerificationSessionStatus.failed,
      });

      await expect(
        service.submitToStep('session123', 'step1', submitDto),
      ).rejects.toThrow(BadRequestException);

      // Check that the step was marked as failed (should be the last call)
      const updateCalls = mockPrismaService.sessionStep.update.mock.calls;
      const lastCall = updateCalls[updateCalls.length - 1];
      expect(lastCall[0]).toMatchObject({
        where: { id: 'step1' },
        data: expect.objectContaining({
          status: SessionStepStatus.failed,
          error: 'Invalid verification code',
        }),
      });
    });
  });

  describe('resumeSession', () => {
    it('should resume expired session', async () => {
      const expiredSession = {
        id: 'session123',
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.expired,
        contextId: 'user123',
        metadata: {},
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [],
        submissions: [],
      };

      const resumedSession = {
        ...expiredSession,
        status: VerificationSessionStatus.pending,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };

      mockPrismaService.session.findUnique
        .mockResolvedValueOnce(expiredSession)
        .mockResolvedValueOnce(resumedSession);

      mockPrismaService.session.update.mockResolvedValue(resumedSession);

      const result = await service.resumeSession('session123');

      expect(result.status).toBe(VerificationSessionStatus.pending);
      expect(mockPrismaService.session.update).toHaveBeenCalledWith({
        where: { id: 'session123' },
        data: {
          status: VerificationSessionStatus.pending,
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should reject resuming completed session', async () => {
      const completedSession = {
        id: 'session123',
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.completed,
        contextId: 'user123',
        metadata: {},
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
        failedAt: null,
        steps: [],
        submissions: [],
      };

      mockPrismaService.session.findUnique.mockResolvedValue(completedSession);

      await expect(service.resumeSession('session123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getSessionsByContext', () => {
    it('should return sessions for given context ID', async () => {
      const mockSessions = [
        {
          id: 'session1',
          type: SessionType.otp_verification,
          status: VerificationSessionStatus.completed,
          contextId: 'user123',
          metadata: {},
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
          failedAt: null,
          steps: [],
          submissions: [],
        },
        {
          id: 'session2',
          type: SessionType.claim_verification,
          status: VerificationSessionStatus.pending,
          contextId: 'user123',
          metadata: {},
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          failedAt: null,
          steps: [],
          submissions: [],
        },
      ];

      mockPrismaService.session.findMany.mockResolvedValue(mockSessions);

      const result = await service.getSessionsByContext('user123');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session1');
      expect(result[1].id).toBe('session2');
      expect(mockPrismaService.session.findMany).toHaveBeenCalledWith({
        where: { contextId: 'user123' },
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          submissions: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
