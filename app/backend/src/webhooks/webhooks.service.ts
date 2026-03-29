import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { UpdateWebhookSubscriptionDto } from './dto/update-webhook-subscription.dto';
import { WEBHOOK_QUEUE, WebhookEvent } from './webhook-events';
import { Queue } from 'bullmq';
import { WebhookJobData } from './interfaces/webhook-job.interface';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_QUEUE)
    private readonly webhookQueue: Queue<WebhookJobData>,
  ) {}

  async createSubscription(
    apiKeyId: string,
    dto: CreateWebhookSubscriptionDto,
  ) {
    return this.prisma.webhookSubscription.create({
      data: {
        apiKeyId,
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async listSubscriptions(apiKeyId: string) {
    return this.prisma.webhookSubscription.findMany({
      where: { apiKeyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateSubscription(
    apiKeyId: string,
    id: string,
    dto: UpdateWebhookSubscriptionDto,
  ) {
    await this.ensureOwnedSubscription(apiKeyId, id);

    return this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
        isActive: dto.isActive,
      },
    });
  }

  async deleteSubscription(apiKeyId: string, id: string) {
    await this.ensureOwnedSubscription(apiKeyId, id);
    await this.prisma.webhookSubscription.delete({ where: { id } });

    return { deleted: true };
  }

  async enqueueEvent(
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        events: {
          has: event,
        },
      },
      select: { id: true },
    });

    if (subscriptions.length === 0) {
      this.logger.debug(`No webhook subscriptions registered for ${event}`);
      return 0;
    }

    await Promise.all(
      subscriptions.map(subscription =>
        this.webhookQueue.add(
          `deliver-${event}`,
          {
            subscriptionId: subscription.id,
            event,
            payload,
          },
          {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        ),
      ),
    );

    this.logger.log(
      `Enqueued ${subscriptions.length} webhook deliveries for ${event}`,
    );

    return subscriptions.length;
  }

  private async ensureOwnedSubscription(apiKeyId: string, id: string) {
    const subscription = await this.prisma.webhookSubscription.findFirst({
      where: { id, apiKeyId },
    });

    if (!subscription) {
      throw new NotFoundException('Webhook subscription not found');
    }

    return subscription;
  }
}
