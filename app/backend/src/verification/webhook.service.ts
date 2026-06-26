import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly webhookUrl: string;

  constructor(
    @InjectQueue('webhooks') private readonly webhooksQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.webhookUrl =
      this.configService.get<string>('VERIFICATION_WEBHOOK_URL') ||
      'http://localhost:3002/webhook';
  }

  /**
   * Enqueue a verification result to be sent via webhook.
   */
  async enqueueWebhook(claimId: string, status: string, result: any): Promise<void> {
    const payload = {
      event: 'verification.completed',
      claimId,
      status,
      score: result.score,
      confidence: result.confidence,
      details: result.details,
    };

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        url: this.webhookUrl,
        payload: JSON.stringify(payload),
        status: 'pending',
        entityId: claimId,
        entityType: 'claim',
      },
    });

    const attempts = parseInt(this.configService.get('WEBHOOK_MAX_ATTEMPTS') || '5', 10);
    const delay = parseInt(this.configService.get('WEBHOOK_BACKOFF_DELAY_MS') || '5000', 10);

    await this.webhooksQueue.add(
      'deliver',
      { webhookDeliveryId: delivery.id },
      {
        attempts,
        backoff: {
          type: 'exponential',
          delay,
        },
      },
    );

    this.logger.log(
      `Enqueued webhook delivery job ${delivery.id} for claim ${claimId} to ${this.webhookUrl}`,
    );
  }

  /**
   * Replay a failed webhook delivery by ID.
   */
  async replayWebhook(id: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id },
    });

    if (!delivery) {
      throw new NotFoundException(`Webhook delivery with ID ${id} not found`);
    }

    // Reset status to pending
    const updated = await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: 'pending',
        retryCount: 0,
        lastError: null,
      },
    });

    const attempts = parseInt(this.configService.get('WEBHOOK_MAX_ATTEMPTS') || '5', 10);
    const delay = parseInt(this.configService.get('WEBHOOK_BACKOFF_DELAY_MS') || '5000', 10);

    await this.webhooksQueue.add(
      'deliver',
      { webhookDeliveryId: updated.id },
      {
        attempts,
        backoff: {
          type: 'exponential',
          delay,
        },
      },
    );

    this.logger.log(
      `Replayed webhook delivery job ${updated.id} for entity ${updated.entityId} to ${updated.url}`,
    );

    return updated;
  }
}
