import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import {
  SessionType,
  VerificationSessionStatus,
  SessionStepStatus,
} from '@prisma/client';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitStepDto } from './dto/submit-step.dto';

describe('SessionController', () => {
  let controller: SessionController;

  const mockSessionService = {
    createSession: jest.fn(),
    getSession: jest.fn(),
    submitToStep: jest.fn(),
    resumeSession: jest.fn(),
    getSessionsByContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a session successfully', async () => {
      const createDto: CreateSessionDto = {
        type: SessionType.otp_verification,
        contextId: 'user123',
        metadata: { channel: 'email' },
      };

      const expectedResponse = {
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
      };

      mockSessionService.createSession.mockResolvedValue(expectedResponse);

      const result = await controller.createSession(createDto);

      expect(result).toEqual(expectedResponse);
      expect(mockSessionService.createSession).toHaveBeenCalledWith(createDto);
    });

    it('should create a multi-step session', async () => {
      const createDto: CreateSessionDto = {
        type: SessionType.multi_step_verification,
        contextId: 'claim456',
        steps: [
          { stepName: 'document_upload', stepOrder: 1 },
          { stepName: 'identity_verification', stepOrder: 2 },
        ],
      };

      const expectedResponse = {
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
            maxAttempts: 3,
            startedAt: null,
            completedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        currentStep: {
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
      };

      mockSessionService.createSession.mockResolvedValue(expectedResponse);

      const result = await controller.createSession(createDto);

      expect(result.steps).toHaveLength(2);
      expect(result.currentStep?.stepName).toBe('document_upload');
      expect(mockSessionService.createSession).toHaveBeenCalledWith(createDto);
    });
  });

  describe('getSession', () => {
    it('should retrieve session by ID', async () => {
      const sessionId = 'session123';
      const expectedResponse = {
        id: sessionId,
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
      };

      mockSessionService.getSession.mockResolvedValue(expectedResponse);

      const result = await controller.getSession(sessionId);

      expect(result).toEqual(expectedResponse);
      expect(mockSessionService.getSession).toHaveBeenCalledWith(sessionId);
    });
  });

  describe('submitToStep', () => {
    it('should submit data to step successfully', async () => {
      const sessionId = 'session123';
      const stepId = 'step1';
      const submitDto: SubmitStepDto = {
        submissionKey: 'unique-key-123',
        payload: { code: '123456', expectedCode: '123456' },
      };

      const expectedResponse = {
        id: 'submission123',
        sessionId,
        stepId,
        submissionKey: 'unique-key-123',
        payload: submitDto.payload,
        response: { success: true, validated: true },
        createdAt: new Date(),
        isIdempotent: false,
      };

      mockSessionService.submitToStep.mockResolvedValue(expectedResponse);

      const result = await controller.submitToStep(
        sessionId,
        stepId,
        submitDto,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockSessionService.submitToStep).toHaveBeenCalledWith(
        sessionId,
        stepId,
        submitDto,
      );
    });

    it('should handle idempotent submission', async () => {
      const sessionId = 'session123';
      const stepId = 'step1';
      const submitDto: SubmitStepDto = {
        submissionKey: 'duplicate-key',
        payload: { code: '123456' },
      };

      const expectedResponse = {
        id: 'submission123',
        sessionId,
        stepId,
        submissionKey: 'duplicate-key',
        payload: submitDto.payload,
        response: { success: true },
        createdAt: new Date(),
        isIdempotent: true,
      };

      mockSessionService.submitToStep.mockResolvedValue(expectedResponse);

      const result = await controller.submitToStep(
        sessionId,
        stepId,
        submitDto,
      );

      expect(result.isIdempotent).toBe(true);
      expect(mockSessionService.submitToStep).toHaveBeenCalledWith(
        sessionId,
        stepId,
        submitDto,
      );
    });
  });

  describe('resumeSession', () => {
    it('should resume session successfully', async () => {
      const sessionId = 'session123';
      const expectedResponse = {
        id: sessionId,
        type: SessionType.otp_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'user123',
        metadata: {},
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
        steps: [],
      };

      mockSessionService.resumeSession.mockResolvedValue(expectedResponse);

      const result = await controller.resumeSession(sessionId);

      expect(result).toEqual(expectedResponse);
      expect(mockSessionService.resumeSession).toHaveBeenCalledWith(sessionId);
    });
  });

  describe('getSessions', () => {
    it('should get sessions by context ID', async () => {
      const contextId = 'user123';
      const expectedResponse = [
        {
          id: 'session1',
          type: SessionType.otp_verification,
          status: VerificationSessionStatus.completed,
          contextId,
          metadata: {},
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
          failedAt: null,
          steps: [],
        },
        {
          id: 'session2',
          type: SessionType.claim_verification,
          status: VerificationSessionStatus.pending,
          contextId,
          metadata: {},
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          failedAt: null,
          steps: [],
        },
      ];

      mockSessionService.getSessionsByContext.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getSessions(contextId);

      expect(result).toEqual(expectedResponse);
      expect(mockSessionService.getSessionsByContext).toHaveBeenCalledWith(
        contextId,
      );
    });

    it('should return empty array when no context ID provided', async () => {
      const result = await controller.getSessions();

      expect(result).toEqual([]);
      expect(mockSessionService.getSessionsByContext).not.toHaveBeenCalled();
    });
  });
});
