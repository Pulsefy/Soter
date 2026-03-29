import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import axios from 'axios';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WEBHOOK_QUEUE } from './webhook-events';
import {
  WebhookDeliveryResult,
  WebhookJobData,
} from './interfaces/webhook-job.interface';

@Injectable()
@Processor(WEBHOOK_QUEUE, {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY ?? '5', 10),
})
export class WebhooksProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(
    job: Job<WebhookJobData, WebhookDeliveryResult>,
  ): Promise<WebhookDeliveryResult> {
    const subscription = await this.prisma.webhookSubscription.findUnique({
      where: { id: job.data.subscriptionId },
    });

    if (!subscription || !subscription.isActive) {
      this.logger.warn(
        `Skipping webhook job ${job.id} because the subscription is missing or inactive`,
      );
      return { delivered: false, responseStatus: 410 };
    }

    const timestamp = new Date().toISOString();
    const body = JSON.stringify(job.data.payload);
    const signature = createHmac('sha256', subscription.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    const attempt = job.attemptsMade + 1;

    try {
      const response = await axios.post(subscription.url, job.data.payload, {
        timeout: 10000,
        headers: {
          'content-type': 'application/json',
          'x-soter-event': job.data.event,
          'x-soter-signature': `sha256=${signature}`,
          'x-soter-timestamp': timestamp,
          'x-soter-subscription-id': subscription.id,
        },
        validateStatus: () => true,
      });

      const responseBody = this.serializeResponseBody(response.data);

      if (response.status >= 400) {
        await this.recordAttempt({
          subscriptionId: subscription.id,
          event: job.data.event,
          payload: job.data.payload,
          attempt,
          status: 'failed',
          responseStatus: response.status,
          responseBody,
          errorMessage: `Remote endpoint returned HTTP ${response.status}`,
        });

        throw new Error(`Webhook delivery failed with HTTP ${response.status}`);
      }

      await this.recordAttempt({
        subscriptionId: subscription.id,
        event: job.data.event,
        payload: job.data.payload,
        attempt,
        status: 'delivered',
        responseStatus: response.status,
        responseBody,
        deliveredAt: new Date(),
      });

      return {
        delivered: true,
        responseStatus: response.status,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown webhook error';

      if (!message.startsWith('Webhook delivery failed with HTTP')) {
        await this.recordAttempt({
          subscriptionId: subscription.id,
          event: job.data.event,
          payload: job.data.payload,
          attempt,
          status: 'failed',
          errorMessage: message,
        });
      }

      this.logger.error(
        `Webhook job ${job.id} failed on attempt ${attempt}: ${message}`,
      );

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<WebhookJobData, WebhookDeliveryResult>) {
    this.logger.log(
      `Webhook job ${job.id} delivered ${job.data.event} successfully`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookJobData> | undefined, error: Error) {
    if (!job) {
      this.logger.error(`Webhook worker failure: ${error.message}`);
      return;
    }

    this.logger.error(
      `Webhook job ${job.id} for ${job.data.event} failed: ${error.message}`,
    );
  }

  private serializeResponseBody(data: unknown): string | undefined {
    if (data === undefined) {
      return undefined;
    }

    if (typeof data === 'string') {
      return data;
    }

    return JSON.stringify(data);
  }

  private recordAttempt(params: {
    subscriptionId: string;
    event: string;
    payload: Record<string, unknown>;
    attempt: number;
    status: string;
    responseStatus?: number;
    responseBody?: string;
    errorMessage?: string;
    deliveredAt?: Date;
  }) {
    return this.prisma.webhookDeliveryAttempt.create({
      data: {
        ...params,
        payload: params.payload as Prisma.InputJsonValue,
      },
    });
  }
}
