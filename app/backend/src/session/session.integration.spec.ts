import { Test, TestingModule } from '@nestjs/testing';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SessionType,
  VerificationSessionStatus,
  SessionStepStatus,
} from '@prisma/client';

describe('Session Integration Tests', () => {
  let service: SessionService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: PrismaService,
          useValue: {
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
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = moduleFixture.get<SessionService>(SessionService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('Complete Multi-Step Verification Flow', () => {
    it('should handle complete multi-step verification with idempotent submissions', async () => {
      // Mock session creation
      const mockSession = {
        id: 'session123',
        type: SessionType.multi_step_verification,
        status: VerificationSessionStatus.pending,
        contextId: 'claim123',
        metadata: { claimAmount: 1000 },
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

      (prisma.session.create as jest.Mock).mockResolvedValue(mockSession);

      const session = await service.createSession({
        type: SessionType.multi_step_verification,
        contextId: 'claim123',
        metadata: { claimAmount: 1000 },
        steps: [
          { stepName: 'document_upload', stepOrder: 1, maxAttempts: 3 },
          { stepName: 'identity_verification', stepOrder: 2, maxAttempts: 2 },
        ],
      });

      expect(session.type).toBe(SessionType.multi_step_verification);
      expect(session.steps).toHaveLength(2);
      expect(session.currentStep?.stepName).toBe('document_upload');
    });

    it('should handle idempotent submissions correctly', async () => {
      // Test idempotent submission handling
      const existingSubmission = {
        id: 'submission123',
        sessionId: 'session123',
        stepId: 'step1',
        submissionKey: 'doc-upload-001',
        payload: { documentUrl: 'https://example.com/doc.pdf' },
        response: { success: true },
        createdAt: new Date(),
      };

      (prisma.sessionSubmission.findUnique as jest.Mock).mockResolvedValue(
        existingSubmission,
      );

      const result = await service.submitToStep('session123', 'step1', {
        submissionKey: 'doc-upload-001',
        payload: { documentUrl: 'https://example.com/doc.pdf' },
      });

      expect(result.isIdempotent).toBe(true);
      expect(result.submissionKey).toBe('doc-upload-001');
    });
  });

  describe('Session Management', () => {
    it('should retrieve sessions by context ID', async () => {
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
      ];

      (prisma.session.findMany as jest.Mock).mockResolvedValue(mockSessions);

      const result = await service.getSessionsByContext('user123');

      expect(result).toHaveLength(1);
      expect(result[0].contextId).toBe('user123');
    });

    it('should handle session resumption', async () => {
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

      (prisma.session.findUnique as jest.Mock)
        .mockResolvedValueOnce(expiredSession)
        .mockResolvedValueOnce(resumedSession);
      (prisma.session.update as jest.Mock).mockResolvedValue(resumedSession);

      const result = await service.resumeSession('session123');

      expect(result.status).toBe(VerificationSessionStatus.pending);
    });
  });
});
