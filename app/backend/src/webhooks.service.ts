import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SessionService } from '../session/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiVerificationPayloadDto } from './dto/ai-verification.dto';
import { Prisma, SessionStatus, StepStatus } from '@prisma/client';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async processAiVerification(payload: AiVerificationPayloadDto) {
    const { eventId, sessionId, status, details } = payload;

    // 1. Idempotency Check
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent) {
      this.logger.log(`Webhook event ${eventId} already processed. Skipping.`);
      throw new ConflictException('Event already processed');
    }

    // 2. Find the relevant session and step
    const session = await this.sessionService.getSession(sessionId);
    if (!session || session.status !== SessionStatus.pending) {
      throw new NotFoundException(`Active session ${sessionId} not found.`);
    }

    const verificationStep = session.steps.find(
      step =>
        step.stepName === 'identity_verification' &&
        step.status === StepStatus.in_progress,
    );

    if (!verificationStep) {
      throw new NotFoundException(
        `Pending identity_verification step not found for session ${sessionId}.`,
      );
    }

    // 3. Record the event and submit to the session step
    await this.prisma.$transaction(async tx => {
      await tx.webhookEvent.create({
        data: {
          eventId,
          payload: payload as unknown as Prisma.InputJsonValue,
          source: 'ai_service',
        },
      });

      // The submitToStep method in the provided context takes three arguments.
      // We will adapt the call to match it.
      await this.sessionService.submitToStep(sessionId, verificationStep.id, {
        submissionKey: eventId, // Use eventId for idempotency in the session
        payload: { status, details },
      });
    });

    this.logger.log(
      `Successfully processed AI verification for event ${eventId}`,
    );
    return { status: 'success', eventId };
  }
}
