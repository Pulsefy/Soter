import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { HmacService } from '../common/hmac/hmac.service';
import { DlqService } from '../jobs/dlq.service';
import { MetricsService } from '../observability/metrics/metrics.service';

@Processor('webhooks', {
  concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly hmacService: HmacService,
    private readonly dlqService: DlqService,
    private readonly metricsService: MetricsService,
  ) {
    super();
  }

  async process(job: Job<{ webhookDeliveryId: string }, any, string>): Promise<any> {
    const { webhookDeliveryId } = job.data;

    this.logger.log(
      `Processing webhook delivery job ${job.id} for record ${webhookDeliveryId} (attempt ${job.attemptsMade + 1})`,
    );

    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: webhookDeliveryId },
    });

    if (!delivery) {
      throw new Error(`Webhook delivery record ${webhookDeliveryId} not found`);
    }

    if (delivery.status === 'sent') {
      this.logger.warn(`Webhook delivery record ${webhookDeliveryId} already marked sent. Skipping.`);
      return;
    }

    await this.prisma.webhookDelivery.update({
      where: { id: webhookDeliveryId },
      data: { lastAttemptAt: new Date() },
    });

    const payloadObj = JSON.parse(delivery.payload);
    // Include deliveryId and timestamp as required by WebhookHmacGuard
    const signedPayload = {
      ...payloadObj,
      deliveryId: delivery.id,
      timestamp: new Date().toISOString(),
    };

    const rawBody = JSON.stringify(signedPayload);
    const signature = this.hmacService.sign(rawBody);

    const startTime = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.post(delivery.url, signedPayload, {
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-signature': signature,
          },
          timeout: 10000, // 10s timeout
        }),
      );

      const durationSec = (Date.now() - startTime) / 1000;
      this.metricsService.recordWebhookDeliveryDuration('verification_result', durationSec);

      await this.prisma.webhookDelivery.update({
        where: { id: webhookDeliveryId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          retryCount: job.attemptsMade,
        },
      });

      this.logger.log(`Webhook delivery ${webhookDeliveryId} sent successfully to ${delivery.url}`);
      return { success: true, status: response.status };
    } catch (error: any) {
      const errorMsg = error.response
        ? `Status ${error.response.status}: ${JSON.stringify(error.response.data)}`
        : error.message;

      this.logger.error(`Webhook delivery ${webhookDeliveryId} failed: ${errorMsg}`);

      // Save intermediate failure state
      await this.prisma.webhookDelivery.update({
        where: { id: webhookDeliveryId },
        data: {
          retryCount: job.attemptsMade + 1,
          lastError: errorMsg.slice(0, 500),
        },
      });

      const maxAttempts = job.opts.attempts || 1;
      if (job.attemptsMade + 1 < maxAttempts) {
        this.metricsService.incrementWebhookRetry('verification_result', errorMsg.slice(0, 80));
      }

      throw new Error(errorMsg);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Webhook job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ webhookDeliveryId: string }> | undefined, error: Error) {
    if (job) {
      this.logger.error(
        `Webhook job ${job.id} failed after maximum attempts: ${error.message}`,
      );

      this.metricsService.incrementCallbackFailure('webhook_delivery', error.message.slice(0, 80));

      // Update delivery record to failed
      try {
        await this.prisma.webhookDelivery.update({
          where: { id: job.data.webhookDeliveryId },
          data: { status: 'failed' },
        });
      } catch (err) {
        this.logger.error(`Failed to update webhook delivery status to failed: ${err}`);
      }

      await this.dlqService.moveToDlq('webhooks', job, error);
    }
  }
}
