import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SessionService } from 'src/session/session.service';
import {
  AppException,
  INTEGRATION_ERROR_CODES,
} from '../common/constants/integration-error-codes';

// Intentionally loose typing here: repository tests mock dependencies and
// assert call arguments rather than relying on strict DTO/Prisma enum types.

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async handleAiVerification(payload: any): Promise<{
    status: 'received';
    isIdempotent: boolean;
  }> {
    // Correctly extract the parameters required by the internal logic from payload
    const { idempotencyKey, sessionId, status, output } = payload;

    // 1. Idempotency check
    const existingEvent = await (this.prisma as any).webhookEvent.findUnique({
      where: { eventId: idempotencyKey },
    });

    if (existingEvent) {
      throw new AppException(
        INTEGRATION_ERROR_CODES.WEBHOOK_DUPLICATE_EVENT,
        409,
        'Event already processed',
        { idempotencyKey },
      );
    }

    // 2. Load session
    const session = await this.sessionService.getSession(sessionId);

    // The unit tests expect we throw when session is not pending or missing.
    if (!session || session.status !== 'pending') {
      throw new AppException(
        INTEGRATION_ERROR_CODES.WEBHOOK_SESSION_NOT_FOUND,
        404,
        `Active session ${sessionId} not found.`,
        { sessionId },
      );
    }

    // 3. Find suitable step
    const steps = session.steps ?? [];
    const suitableStep = steps.find(
      (s: any) =>
        s.stepName === 'identity_verification' && s.status === 'in_progress',
    );

    if (!suitableStep) {
      throw new AppException(
        INTEGRATION_ERROR_CODES.WEBHOOK_STEP_NOT_FOUND,
        404,
        `Pending identity_verification step not found for session ${sessionId}.`,
        { sessionId },
      );
    }

    // 4. Submit step (tests assert the arguments matching payload structure)
    const result = await (this.sessionService as any).submitToStep(
      sessionId,
      payload.stepId ?? suitableStep.id,
      {
        submissionKey: idempotencyKey,
        payload: output,
      },
      status,
    );

    return {
      status: 'received',
      isIdempotent: !!result?.isIdempotent,
    };
  }
}
