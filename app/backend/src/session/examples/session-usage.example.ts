/**
 * Session Management Usage Examples
 *
 * This file demonstrates how to use the session management system
 * for various multi-step verification scenarios.
 */

import { SessionService } from '../session.service';
import { SessionType } from '@prisma/client';

export class SessionUsageExamples {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * Example 1: Simple OTP Verification Session
   */
  async createOtpSession() {
    const session = await this.sessionService.createSession({
      type: SessionType.otp_verification,
      contextId: 'user_12345',
      metadata: {
        channel: 'email',
        identifier: 'user@example.com',
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
      steps: [
        {
          stepName: 'otp_validation',
          stepOrder: 1,
          maxAttempts: 3,
          input: {
            expectedCode: '123456', // In real implementation, generate this
          },
        },
      ],
    });

    console.log('OTP Session created:', session.id);
    return session;
  }

  /**
   * Example 2: Multi-Step Identity Verification
   */
  async createIdentityVerificationSession() {
    const session = await this.sessionService.createSession({
      type: SessionType.multi_step_verification,
      contextId: 'kyc_user_67890',
      metadata: {
        verificationType: 'full_kyc',
        riskLevel: 'medium',
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      steps: [
        {
          stepName: 'document_upload',
          stepOrder: 1,
          maxAttempts: 3,
          input: {
            requiredDocuments: ['passport', 'proof_of_address'],
          },
        },
        {
          stepName: 'identity_verification',
          stepOrder: 2,
          maxAttempts: 2,
          input: {
            verificationMethod: 'ai_analysis',
          },
        },
        {
          stepName: 'liveness_check',
          stepOrder: 3,
          maxAttempts: 2,
          input: {
            biometricRequired: true,
          },
        },
      ],
    });

    console.log('Identity Verification Session created:', session.id);
    return session;
  }

  /**
   * Example 3: Claim Verification Workflow
   */
  async createClaimVerificationSession(claimId: string) {
    const session = await this.sessionService.createSession({
      type: SessionType.claim_verification,
      contextId: claimId,
      metadata: {
        claimType: 'humanitarian_aid',
        urgency: 'high',
      },
      steps: [
        {
          stepName: 'eligibility_check',
          stepOrder: 1,
          maxAttempts: 1,
        },
        {
          stepName: 'document_verification',
          stepOrder: 2,
          maxAttempts: 2,
        },
        {
          stepName: 'ai_assessment',
          stepOrder: 3,
          maxAttempts: 1,
        },
        {
          stepName: 'human_review',
          stepOrder: 4,
          maxAttempts: 1,
        },
      ],
    });

    console.log('Claim Verification Session created:', session.id);
    return session;
  }

  /**
   * Example 4: Idempotent Step Submission
   */
  async demonstrateIdempotentSubmission(sessionId: string, stepId: string) {
    const submissionKey = `user_action_${Date.now()}`;

    // First submission
    const result1 = await this.sessionService.submitToStep(sessionId, stepId, {
      submissionKey,
      payload: {
        documentUrl: 'https://example.com/passport.jpg',
        documentType: 'passport',
      },
    });

    console.log('First submission:', result1.isIdempotent); // false

    // Retry same submission (network issue, user double-click, etc.)
    const result2 = await this.sessionService.submitToStep(sessionId, stepId, {
      submissionKey, // Same key
      payload: {
        documentUrl: 'https://example.com/passport.jpg',
        documentType: 'passport',
      },
    });

    console.log('Retry submission:', result2.isIdempotent); // true
    console.log(
      'Same response:',
      JSON.stringify(result1.response) === JSON.stringify(result2.response),
    ); // true
  }

  /**
   * Example 5: Session Status Monitoring
   */
  async monitorSessionProgress(sessionId: string) {
    const session = await this.sessionService.getSession(sessionId);

    const progress = {
      sessionId: session.id,
      status: session.status,
      currentStep: session.currentStep?.stepName,
      nextStep: session.nextStep?.stepName,
      completedSteps:
        session.steps?.filter(s => s.status === 'completed').length || 0,
      totalSteps: session.steps?.length || 0,
      progressPercentage: session.steps
        ? Math.round(
            (session.steps.filter(s => s.status === 'completed').length /
              session.steps.length) *
              100,
          )
        : 0,
    };

    console.log('Session Progress:', progress);
    return progress;
  }

  /**
   * Example 6: Error Handling and Recovery
   */
  async handleStepFailureAndRetry(sessionId: string, stepId: string) {
    try {
      // Attempt step submission
      const result = await this.sessionService.submitToStep(sessionId, stepId, {
        submissionKey: `retry_${Date.now()}`,
        payload: {
          // Some payload that might fail
          riskScore: 0.95, // High risk score that might cause failure
        },
      });

      console.log('Step completed successfully:', result);
      return result;
    } catch (error) {
      console.error(
        'Step failed:',
        error instanceof Error ? error.message : 'Unknown error',
      );

      // Check session status
      const session = await this.sessionService.getSession(sessionId);
      const failedStep = session.steps?.find(s => s.id === stepId);

      if (failedStep && failedStep.attempts < failedStep.maxAttempts) {
        console.log(
          `Step can be retried. Attempts: ${failedStep.attempts}/${failedStep.maxAttempts}`,
        );

        // Could implement retry logic here
        // For example, with exponential backoff
        setTimeout(
          () => {
            console.log('Implementing retry logic...');
          },
          1000 * Math.pow(2, failedStep.attempts),
        );
      } else {
        console.log(
          'Step has reached max attempts. Session may need to be resumed or restarted.',
        );

        // Could try to resume session if it's expired
        if (session.status === 'expired') {
          const resumedSession =
            await this.sessionService.resumeSession(sessionId);
          console.log('Session resumed:', resumedSession.id);
        }
      }

      throw error;
    }
  }

  /**
   * Example 7: Batch Session Operations
   */
  async processMultipleUserSessions(userIds: string[]) {
    const results = await Promise.allSettled(
      userIds.map(async userId => {
        // Get user's verification history
        const sessions = await this.sessionService.getSessionsByContext(userId);

        // Find incomplete sessions
        const incompleteSessions = sessions.filter(s => s.status === 'pending');

        // Resume expired sessions
        const expiredSessions = sessions.filter(s => s.status === 'expired');
        const resumedSessions = await Promise.allSettled(
          expiredSessions.map(s => this.sessionService.resumeSession(s.id)),
        );

        return {
          userId,
          totalSessions: sessions.length,
          incompleteSessions: incompleteSessions.length,
          resumedSessions: resumedSessions.filter(r => r.status === 'fulfilled')
            .length,
        };
      }),
    );

    const summary = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    console.log('Batch processing summary:', summary);
    return summary;
  }

  /**
   * Example 8: Session Analytics and Reporting
   */
  async generateSessionAnalytics(contextIds: string[]) {
    const analytics = await Promise.all(
      contextIds.map(async contextId => {
        const sessions =
          await this.sessionService.getSessionsByContext(contextId);

        const completedSessions = sessions.filter(
          s => s.status === 'completed',
        );
        const failedSessions = sessions.filter(s => s.status === 'failed');
        const expiredSessions = sessions.filter(s => s.status === 'expired');

        // Calculate average completion time for completed sessions
        const avgCompletionTime =
          completedSessions.length > 0
            ? completedSessions.reduce((sum, s) => {
                if (s.completedAt && s.createdAt) {
                  return (
                    sum +
                    (new Date(s.completedAt).getTime() -
                      new Date(s.createdAt).getTime())
                  );
                }
                return sum;
              }, 0) / completedSessions.length
            : 0;

        return {
          contextId,
          totalSessions: sessions.length,
          completionRate:
            sessions.length > 0
              ? (completedSessions.length / sessions.length) * 100
              : 0,
          failureRate:
            sessions.length > 0
              ? (failedSessions.length / sessions.length) * 100
              : 0,
          expirationRate:
            sessions.length > 0
              ? (expiredSessions.length / sessions.length) * 100
              : 0,
          avgCompletionTimeMs: avgCompletionTime,
          avgCompletionTimeMinutes: avgCompletionTime / (1000 * 60),
        };
      }),
    );

    console.log('Session Analytics:', analytics);
    return analytics;
  }
}

/**
 * Usage Instructions:
 *
 * 1. Import and inject SessionService in your service/controller
 * 2. Create sessions with appropriate type and steps
 * 3. Use unique submission keys for idempotent operations
 * 4. Monitor session progress and handle failures gracefully
 * 5. Implement retry logic with exponential backoff
 * 6. Use context IDs to group related sessions
 * 7. Implement session cleanup for expired/old sessions
 *
 * Best Practices:
 *
 * - Always use unique submission keys (UUID, timestamp-based, etc.)
 * - Set appropriate expiration times based on use case
 * - Implement proper error handling and user feedback
 * - Monitor session analytics for optimization opportunities
 * - Use metadata to store additional context information
 * - Implement session cleanup jobs for old/expired sessions
 * - Consider implementing session state webhooks for real-time updates
 */
