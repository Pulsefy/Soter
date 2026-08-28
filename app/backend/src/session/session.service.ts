import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  VerificationSessionStatus,
  SessionStepStatus,
  Session,
  SessionStep,
  SessionSubmission,
} from '@prisma/client';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitStepDto } from './dto/submit-step.dto';
import {
  SessionResponseDto,
  SubmissionResponseDto,
} from './dto/session-response.dto';

export interface SessionWithSteps extends Session {
  steps: SessionStep[];
  submissions: SessionSubmission[];
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new session with optional steps
   */
  async createSession(dto: CreateSessionDto): Promise<SessionResponseDto> {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    // Validate expiration time
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('Expiration time must be in the future');
    }

    const session = await this.prisma.session.create({
      data: {
        type: dto.type,
        contextId: dto.contextId,
        metadata: dto.metadata || {},
        expiresAt,
        steps: dto.steps
          ? {
              create: dto.steps.map((step, index) => ({
                stepName: step.stepName,
                stepOrder: step.stepOrder ?? index + 1,
                maxAttempts: step.maxAttempts ?? 3,
                input: step.input || {},
              })),
            }
          : undefined,
      },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
        },
        submissions: true,
      },
    });

    this.logger.log(`Created session ${session.id} of type ${session.type}`);
    return this.mapSessionToDto(session);
  }

  /**
   * Get session by ID with steps and submissions
   */
  async getSession(sessionId: string): Promise<SessionResponseDto> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
        },
        submissions: true,
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    // Check if session is expired
    if (
      session.expiresAt &&
      session.expiresAt <= new Date() &&
      session.status === VerificationSessionStatus.pending
    ) {
      await this.expireSession(sessionId);
      session.status = VerificationSessionStatus.expired;
    }

    return this.mapSessionToDto(session);
  }

  /**
   * Submit data to a session step with idempotent handling
   */
  async submitToStep(
    sessionId: string,
    stepId: string,
    dto: SubmitStepDto,
  ): Promise<SubmissionResponseDto> {
    // Check for existing submission with same key
    const existingSubmission = await this.prisma.sessionSubmission.findUnique({
      where: { submissionKey: dto.submissionKey },
    });

    if (existingSubmission) {
      this.logger.log(`Idempotent submission detected: ${dto.submissionKey}`);
      return {
        id: existingSubmission.id,
        sessionId: existingSubmission.sessionId,
        stepId: existingSubmission.stepId ?? undefined,
        submissionKey: existingSubmission.submissionKey,
        payload: existingSubmission.payload as Record<string, unknown>,
        response: existingSubmission.response as Record<string, unknown>,
        createdAt: existingSubmission.createdAt,
        isIdempotent: true,
      };
    }

    // Validate session and step
    const session = await this.getSession(sessionId);
    if (session.status !== VerificationSessionStatus.pending) {
      throw new BadRequestException(
        `Session ${sessionId} is not in pending state`,
      );
    }

    const step = session.steps?.find(s => s.id === stepId);
    if (!step) {
      throw new NotFoundException(
        `Step ${stepId} not found in session ${sessionId}`,
      );
    }

    if (step.status === SessionStepStatus.completed) {
      throw new ConflictException(`Step ${stepId} is already completed`);
    }

    // Process the submission
    const result = await this.processStepSubmission(sessionId, stepId, dto);

    // Create submission record
    const submission = await this.prisma.sessionSubmission.create({
      data: {
        sessionId,
        stepId,
        submissionKey: dto.submissionKey,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payload: dto.payload as any,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        response: result as any,
      },
    });

    this.logger.log(
      `Processed submission ${dto.submissionKey} for step ${stepId}`,
    );

    return {
      id: submission.id,
      sessionId: submission.sessionId,
      stepId: submission.stepId ?? undefined,
      submissionKey: submission.submissionKey,
      payload: submission.payload as Record<string, unknown>,
      response: submission.response as Record<string, unknown>,
      createdAt: submission.createdAt,
      isIdempotent: false,
    };
  }

  /**
   * Process step submission and update step status
   */
  private async processStepSubmission(
    sessionId: string,
    stepId: string,
    dto: SubmitStepDto,
  ): Promise<Record<string, unknown>> {
    const step = await this.prisma.sessionStep.findUnique({
      where: { id: stepId },
    });

    if (!step) {
      throw new NotFoundException(`Step ${stepId} not found`);
    }

    // Update step to in_progress if not already
    if (step.status === SessionStepStatus.pending) {
      await this.prisma.sessionStep.update({
        where: { id: stepId },
        data: {
          status: SessionStepStatus.in_progress,
          startedAt: new Date(),
        },
      });
    }

    // Increment attempts
    const updatedStep = await this.prisma.sessionStep.update({
      where: { id: stepId },
      data: {
        attempts: { increment: 1 },
      },
    });

    try {
      // Process based on step type
      const result = this.executeStepLogic(step.stepName, dto.payload);

      // Mark step as completed
      await this.prisma.sessionStep.update({
        where: { id: stepId },
        data: {
          status: SessionStepStatus.completed,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          output: result as any,
          completedAt: new Date(),
        },
      });

      // Check if all steps are completed
      await this.checkSessionCompletion(sessionId);

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Check if max attempts reached
      if (updatedStep.attempts >= updatedStep.maxAttempts) {
        await this.prisma.sessionStep.update({
          where: { id: stepId },
          data: {
            status: SessionStepStatus.failed,
            error: errorMessage,
          },
        });

        // Mark session as failed if critical step fails
        await this.failSession(
          sessionId,
          `Step ${step.stepName} failed after ${updatedStep.maxAttempts} attempts`,
        );
      } else {
        await this.prisma.sessionStep.update({
          where: { id: stepId },
          data: {
            error: errorMessage,
          },
        });
      }

      throw error;
    }
  }

  /**
   * Execute step-specific logic
   */
  private executeStepLogic(
    stepName: string,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (stepName) {
      case 'otp_validation':
        return this.validateOtp(payload);
      case 'document_upload':
        return this.processDocumentUpload(payload);
      case 'identity_verification':
        return this.verifyIdentity(payload);
      case 'claim_verification':
        return this.verifyClaim(payload);
      default:
        // Generic processing - just return success
        return {
          success: true,
          processed: true,
          timestamp: new Date().toISOString(),
        };
    }
  }

  /**
   * OTP validation logic
   */
  private validateOtp(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const { code, expectedCode } = payload as {
      code: string;
      expectedCode: string;
    };

    if (!code || !expectedCode) {
      throw new BadRequestException('Code and expectedCode are required');
    }

    if (code !== expectedCode) {
      throw new BadRequestException('Invalid verification code');
    }

    return {
      success: true,
      validated: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Document upload processing
   */
  private processDocumentUpload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const { documentUrl, documentType } = payload as {
      documentUrl: string;
      documentType?: string;
    };

    if (!documentUrl) {
      throw new BadRequestException('Document URL is required');
    }

    // Simulate document processing
    return {
      success: true,
      documentId: `doc_${Date.now()}`,
      documentType: documentType || 'unknown',
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Identity verification logic
   */
  private verifyIdentity(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const { identityDocument, personalInfo } = payload as {
      identityDocument: unknown;
      personalInfo: unknown;
    };

    if (!identityDocument || !personalInfo) {
      throw new BadRequestException(
        'Identity document and personal info are required',
      );
    }

    // Simulate identity verification
    const score = Math.random() * 100;
    const passed = score > 70;

    return {
      success: passed,
      score,
      verificationId: `verify_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Claim verification logic
   */
  private verifyClaim(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const { claimId } = payload as { claimId: string };

    if (!claimId) {
      throw new BadRequestException('Claim ID is required');
    }

    // Simulate claim verification
    const score = Math.random() * 100;
    const approved = score > 60;

    return {
      success: approved,
      score,
      claimId,
      verificationResult: approved ? 'approved' : 'rejected',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check if all steps are completed and update session status
   */
  private async checkSessionCompletion(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { steps: true },
    });

    if (!session) return;

    const allStepsCompleted = session.steps.every(
      step =>
        step.status === SessionStepStatus.completed ||
        step.status === SessionStepStatus.skipped,
    );

    if (allStepsCompleted) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: {
          status: VerificationSessionStatus.completed,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Session ${sessionId} completed successfully`);
    }
  }

  /**
   * Mark session as failed
   */
  private async failSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: VerificationSessionStatus.failed,
        failedAt: new Date(),
        metadata: {
          failureReason: reason,
        },
      },
    });

    this.logger.warn(`Session ${sessionId} failed: ${reason}`);
  }

  /**
   * Mark session as expired
   */
  private async expireSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: VerificationSessionStatus.expired,
      },
    });

    this.logger.log(`Session ${sessionId} expired`);
  }

  /**
   * Get sessions by context ID
   */
  async getSessionsByContext(contextId: string): Promise<SessionResponseDto[]> {
    const sessions = await this.prisma.session.findMany({
      where: { contextId },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
        },
        submissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map(session => this.mapSessionToDto(session));
  }

  /**
   * Resume a session by creating next step or reactivating
   */
  async resumeSession(sessionId: string): Promise<SessionResponseDto> {
    const session = await this.getSession(sessionId);

    if (session.status === VerificationSessionStatus.completed) {
      throw new BadRequestException('Cannot resume completed session');
    }

    if (session.status === VerificationSessionStatus.expired) {
      // Extend expiration if possible
      const newExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      await this.prisma.session.update({
        where: { id: sessionId },
        data: {
          status: VerificationSessionStatus.pending,
          expiresAt: newExpiresAt,
        },
      });

      this.logger.log(`Resumed expired session ${sessionId}`);
    }

    return this.getSession(sessionId);
  }

  /**
   * Map session entity to DTO
   */
  private mapSessionToDto(session: SessionWithSteps): SessionResponseDto {
    const steps = session.steps.map(step => ({
      id: step.id,
      stepName: step.stepName,
      stepOrder: step.stepOrder,
      status: step.status,
      input: step.input as Record<string, unknown>,
      output: step.output as Record<string, unknown>,
      error: step.error ?? undefined,
      attempts: step.attempts,
      maxAttempts: step.maxAttempts,
      startedAt: step.startedAt ?? undefined,
      completedAt: step.completedAt ?? undefined,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    }));

    const currentStep = steps.find(
      s =>
        s.status === SessionStepStatus.pending ||
        s.status === SessionStepStatus.in_progress,
    );

    const nextStep = steps.find(
      s =>
        s.status === SessionStepStatus.pending &&
        s.stepOrder > (currentStep?.stepOrder || 0),
    );

    return {
      id: session.id,
      type: session.type,
      status: session.status,
      contextId: session.contextId ?? undefined,
      metadata: session.metadata as Record<string, unknown>,
      expiresAt: session.expiresAt ?? undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt ?? undefined,
      failedAt: session.failedAt ?? undefined,
      steps,
      currentStep,
      nextStep,
    };
  }
}
