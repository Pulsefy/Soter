import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SessionService } from 'src/session/session.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiVerificationPayloadDto } from 'src/ai-verification.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async processAiVerification(payload: AiVerificationPayloadDto) {
    const { eventId, sessionId, status, details } = payload;

    // 1. Idempotency Check using a safe index signature access or explicit model lookup
    const existingEvent = await (this.prisma as any).webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent) {
      this.logger.log(`Webhook event ${eventId} already processed. Skipping.`);
      throw new ConflictException('Event already processed');
    }

    // 2. Find the relevant session and step
    const session = await this.sessionService.getSession(sessionId);
    if (!session || session.status !== 'pending') {
      throw new NotFoundException(`Active session ${sessionId} not found.`);
    }

    // Optional chaining prevents compilation failures if session.steps is missing
    const verificationStep = session?.steps?.find(
      (step: any) =>
        step.stepName === 'identity_verification' &&
        step.status === 'in_progress',
    );

    if (!verificationStep) {
      throw new NotFoundException(
        `Pending identity_verification step not found for session ${sessionId}.`,
      );
    }

    // 3. Record the event and submit to the session step
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.webhookEvent.create({
        data: {
          eventId,
          payload: payload as unknown as Prisma.InputJsonValue,
          source: 'ai_service',
        },
      });

      await this.sessionService.submitToStep(sessionId, verificationStep.id, {
        submissionKey: eventId,
        payload: { status, details },
      });
    });

    this.logger.log(
      `Successfully processed AI verification for event ${eventId}`,
    );
    return { status: 'success', eventId };
  }
}
