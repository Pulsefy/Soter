import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SessionService } from '../session/session.service';
import { VerificationFlowService } from './verification-flow.service';
import { SessionType } from '@prisma/client';
import { StartVerificationDto } from './dto/start-verification.dto';
import { CompleteVerificationDto } from './dto/complete-verification.dto';

@Injectable()
export class EnhancedVerificationFlowService {
  private readonly logger = new Logger(EnhancedVerificationFlowService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly verificationFlowService: VerificationFlowService,
  ) {}

  /**
   * Start a comprehensive verification session that includes OTP + additional steps
   */
  async startEnhancedVerification(
    dto: StartVerificationDto & {
      includeIdentityVerification?: boolean;
      includeDocumentUpload?: boolean;
    },
  ) {
    // Create the traditional OTP session first
    const otpResult = await this.verificationFlowService.start(dto);

    // Determine additional steps based on requirements
    const steps = [
      { stepName: 'otp_validation', stepOrder: 1, maxAttempts: 3 },
    ];

    if (dto.includeDocumentUpload) {
      steps.push({ stepName: 'document_upload', stepOrder: 2, maxAttempts: 2 });
    }

    if (dto.includeIdentityVerification) {
      steps.push({
        stepName: 'identity_verification',
        stepOrder: steps.length + 1,
        maxAttempts: 2,
      });
    }

    // Create enhanced session that tracks the complete flow
    const session = await this.sessionService.createSession({
      type: SessionType.multi_step_verification,
      contextId: otpResult.sessionId, // Link to OTP session
      metadata: {
        channel: dto.channel,
        originalOtpSessionId: otpResult.sessionId,
        expiresAt: otpResult.expiresAt,
      },
      expiresAt: otpResult.expiresAt,
      steps,
    });

    this.logger.log(
      `Enhanced verification session ${session.id} started for ${dto.channel}`,
    );

    return {
      sessionId: session.id,
      otpSessionId: otpResult.sessionId,
      channel: dto.channel,
      expiresAt: otpResult.expiresAt,
      message: otpResult.message,
      steps: session.steps,
      currentStep: session.currentStep,
    };
  }

  /**
   * Complete OTP step using the enhanced session
   */
  async completeOtpStep(
    sessionId: string,
    dto: CompleteVerificationDto & { submissionKey: string },
  ) {
    const session = await this.sessionService.getSession(sessionId);

    if (
      !session.currentStep ||
      session.currentStep.stepName !== 'otp_validation'
    ) {
      throw new BadRequestException(
        'OTP validation step is not current or available',
      );
    }

    const metadata = session.metadata;
    const otpSessionId = metadata?.originalOtpSessionId as string | undefined;
    if (!otpSessionId) {
      throw new BadRequestException('Original OTP session ID not found');
    }

    try {
      // Complete the traditional OTP verification
      const otpResult = await this.verificationFlowService.complete({
        sessionId: otpSessionId,
        code: dto.code,
      });

      // Submit to the enhanced session step
      const stepResult = await this.sessionService.submitToStep(
        sessionId,
        session.currentStep.id,
        {
          submissionKey: dto.submissionKey,
          payload: {
            code: dto.code,
            expectedCode: dto.code, // In real implementation, get from OTP session
            otpResult,
          },
        },
      );

      this.logger.log(`OTP step completed for session ${sessionId}`);

      return {
        success: true,
        stepCompleted: 'otp_validation',
        nextStep: session.nextStep?.stepName,
        sessionStatus: session.status,
        submission: stepResult,
      };
    } catch (error) {
      this.logger.error(
        `OTP step failed for session ${sessionId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw error;
    }
  }

  /**
   * Submit document for verification
   */
  async submitDocument(
    sessionId: string,
    submissionKey: string,
    documentData: {
      documentUrl: string;
      documentType: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const session = await this.sessionService.getSession(sessionId);

    const documentStep = session.steps?.find(
      s => s.stepName === 'document_upload',
    );
    if (!documentStep) {
      throw new BadRequestException(
        'Document upload step not found in session',
      );
    }

    const stepResult = await this.sessionService.submitToStep(
      sessionId,
      documentStep.id,
      {
        submissionKey,
        payload: {
          documentUrl: documentData.documentUrl,
          documentType: documentData.documentType,
          metadata: documentData.metadata || {},
        },
      },
    );

    this.logger.log(`Document submitted for session ${sessionId}`);

    return {
      success: true,
      stepCompleted: 'document_upload',
      documentId: (stepResult.response as Record<string, unknown>)?.documentId,
      submission: stepResult,
    };
  }

  /**
   * Submit identity information for verification
   */
  async submitIdentityVerification(
    sessionId: string,
    submissionKey: string,
    identityData: {
      identityDocument: Record<string, unknown>;
      personalInfo: Record<string, unknown>;
      biometricData?: Record<string, unknown>;
    },
  ) {
    const session = await this.sessionService.getSession(sessionId);

    const identityStep = session.steps?.find(
      s => s.stepName === 'identity_verification',
    );
    if (!identityStep) {
      throw new BadRequestException(
        'Identity verification step not found in session',
      );
    }

    const stepResult = await this.sessionService.submitToStep(
      sessionId,
      identityStep.id,
      {
        submissionKey,
        payload: {
          identityDocument: identityData.identityDocument,
          personalInfo: identityData.personalInfo,
          biometricData: identityData.biometricData,
        },
      },
    );

    this.logger.log(`Identity verification submitted for session ${sessionId}`);

    return {
      success: true,
      stepCompleted: 'identity_verification',
      verificationScore: (stepResult.response as Record<string, unknown>)
        ?.score,
      verificationId: (stepResult.response as Record<string, unknown>)
        ?.verificationId,
      submission: stepResult,
    };
  }

  /**
   * Get the current status of an enhanced verification session
   */
  async getVerificationStatus(sessionId: string) {
    const session = await this.sessionService.getSession(sessionId);

    const completedSteps =
      session.steps?.filter(s => s.status === 'completed') || [];
    const failedSteps = session.steps?.filter(s => s.status === 'failed') || [];
    const progress = session.steps
      ? (completedSteps.length / session.steps.length) * 100
      : 0;

    return {
      sessionId: session.id,
      status: session.status,
      progress: Math.round(progress),
      completedSteps: completedSteps.map(s => s.stepName),
      failedSteps: failedSteps.map(s => s.stepName),
      currentStep: session.currentStep?.stepName,
      nextStep: session.nextStep?.stepName,
      expiresAt: session.expiresAt,
      completedAt: session.completedAt,
      failedAt: session.failedAt,
      steps: session.steps,
    };
  }

  /**
   * Resume an expired or failed verification session
   */
  async resumeVerification(sessionId: string) {
    const resumedSession = await this.sessionService.resumeSession(sessionId);

    this.logger.log(`Verification session ${sessionId} resumed`);

    return {
      sessionId: resumedSession.id,
      status: resumedSession.status,
      currentStep: resumedSession.currentStep?.stepName,
      expiresAt: resumedSession.expiresAt,
      message: 'Verification session resumed successfully',
    };
  }

  /**
   * Get all verification sessions for a user/context
   */
  async getUserVerificationHistory(contextId: string) {
    const sessions = await this.sessionService.getSessionsByContext(contextId);

    return sessions.map(session => ({
      sessionId: session.id,
      type: session.type,
      status: session.status,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      failedAt: session.failedAt,
      stepsCompleted:
        session.steps?.filter(s => s.status === 'completed').length || 0,
      totalSteps: session.steps?.length || 0,
    }));
  }
}
