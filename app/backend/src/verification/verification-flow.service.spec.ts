import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationFlowService } from './verification-flow.service';
import { PrismaService } from '../prisma/prisma.service';
import { StartVerificationDto } from './dto/start-verification.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { CompleteVerificationDto } from './dto/complete-verification.dto';

describe('VerificationFlowService', () => {
  let service: VerificationFlowService;
  let prisma: {
    verificationSession: {
      count: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  const mockSession = {
    id: 'session-1',
    channel: 'email',
    identifier: 'user@example.com',
    code: '123456',
    attempts: 0,
    resendCount: 0,
    status: 'pending',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      verificationSession: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          ...mockSession,
          id: 'new-session-id',
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationFlowService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, number | undefined> = {
                VERIFICATION_OTP_LENGTH: 6,
                VERIFICATION_OTP_TTL_MINUTES: 10,
                VERIFICATION_MAX_STARTS_PER_IDENTIFIER_PER_HOUR: 5,
                VERIFICATION_MAX_RESENDS_PER_SESSION: 3,
                VERIFICATION_MAX_ATTEMPTS_PER_SESSION: 5,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<VerificationFlowService>(VerificationFlowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('start', () => {
    it('should start a verification session for email', async () => {
      const dto: StartVerificationDto = {
        channel: 'email',
        email: 'user@example.com',
      };

      const result = await service.start(dto);

      expect(result.sessionId).toBe('new-session-id');
      expect(result.channel).toBe('email');
      expect(result.expiresAt).toBeDefined();
      expect(result.message).toContain('email');
      expect(prisma.verificationSession.count).toHaveBeenCalledWith({
        where: {
          identifier: 'user@example.com',
          createdAt: { gte: expect.any(Date) },
        },
      });
      expect(prisma.verificationSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'email',
          identifier: 'user@example.com',
          code: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('should start a verification session for phone', async () => {
      const dto: StartVerificationDto = {
        channel: 'phone',
        phone: '+15551234567',
      };

      const result = await service.start(dto);

      expect(result.sessionId).toBe('new-session-id');
      expect(result.channel).toBe('phone');
      expect(prisma.verificationSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          channel: 'phone',
          identifier: '+15551234567',
        }),
      });
    });

    it('should throw BadRequest when identifier is missing for channel', async () => {
      await expect(
        service.start({ channel: 'email' } as StartVerificationDto),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.start({ channel: 'phone' } as StartVerificationDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest when rate limit exceeded', async () => {
      prisma.verificationSession.count.mockResolvedValue(5);

      const dto: StartVerificationDto = {
        channel: 'email',
        email: 'user@example.com',
      };

      await expect(service.start(dto)).rejects.toThrow(BadRequestException);
      await expect(service.start(dto)).rejects.toThrow(
        'Too many verification requests',
      );
    });
  });

  describe('resend', () => {
    it('should resend code for pending session', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue({
        ...mockSession,
        resendCount: 0,
      });

      const dto: ResendVerificationDto = { sessionId: 'session-1' };
      const result = await service.resend(dto);

      expect(result.sessionId).toBe('session-1');
      expect(result.message).toContain('New verification code');
      expect(prisma.verificationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          resendCount: 1,
          code: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
    });

    it('should throw NotFound when session does not exist', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue(null);

      await expect(
        service.resend({ sessionId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequest when session is completed', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue({
        ...mockSession,
        status: 'completed',
      });

      await expect(service.resend({ sessionId: 'session-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequest when session is expired', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue({
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.resend({ sessionId: 'session-1' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resend({ sessionId: 'session-1' })).rejects.toThrow(
        'Session expired',
      );
    });

    it('should throw BadRequest when resend limit exceeded', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue({
        ...mockSession,
        resendCount: 3,
      });

      await expect(service.resend({ sessionId: 'session-1' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.resend({ sessionId: 'session-1' })).rejects.toThrow(
        'Maximum resend limit',
      );
    });
  });

  describe('complete', () => {
    it('should complete verification with correct code', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue(mockSession);

      const dto: CompleteVerificationDto = {
        sessionId: 'session-1',
        code: '123456',
      };

      const result = await service.complete(dto);

      expect(result.verified).toBe(true);
      expect(result.sessionId).toBe('session-1');
      expect(prisma.verificationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { status: 'completed' },
      });
    });

    it('should throw NotFound when session does not exist', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue(null);

      await expect(
        service.complete({
          sessionId: 'nonexistent',
          code: '123456',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequest when code is wrong', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue(mockSession);

      await expect(
        service.complete({
          sessionId: 'session-1',
          code: '999999',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.complete({
          sessionId: 'session-1',
          code: '999999',
        }),
      ).rejects.toThrow('Invalid verification code');

      expect(prisma.verificationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { attempts: 1 },
      });
    });

    it('should throw BadRequest when session is expired', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue({
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.complete({
          sessionId: 'session-1',
          code: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.complete({
          sessionId: 'session-1',
          code: '123456',
        }),
      ).rejects.toThrow('Session expired');
    });

    it('should throw BadRequest when max attempts exceeded', async () => {
      prisma.verificationSession.findUnique.mockResolvedValue({
        ...mockSession,
        attempts: 5,
      });

      await expect(
        service.complete({
          sessionId: 'session-1',
          code: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.complete({
          sessionId: 'session-1',
          code: '123456',
        }),
      ).rejects.toThrow('Too many failed attempts');
    });
  });
});
