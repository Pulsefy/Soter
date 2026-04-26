import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationOutbox } from '@prisma/client';
import {
  NotificationJobData,
  NotificationType,
} from './interfaces/notification-job.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async sendEmail(
    recipient: string,
    subject: string,
    message: string,
    correlationId?: string,
  ): Promise<{ outboxId: string; jobId: string }> {
    // 1. Persist intent before enqueue (status = pending)
    const outbox = await this.prisma.notificationOutbox.create({
      data: {
        type: NotificationType.EMAIL,
        recipient,
        subject,
        message,
        scheduledFor: new Date(),
      },
    });

    // 2. Enqueue the BullMQ job (carries outboxId and correlationId)
    const data: NotificationJobData = {
      type: NotificationType.EMAIL,
      recipient,
      subject,
      message,
      timestamp: Date.now(),
      outboxId: outbox.id,
      correlationId,
    };

    const job = await this.notificationsQueue.add('send-email', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    // 3. Update outbox record to enqueued with the BullMQ job ID
    await this.prisma.notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        status: 'enqueued',
        jobId: String(job.id),
      },
    });

    this.logger.log(
      `Enqueued email job: ${job.id} for ${recipient} (outboxId: ${outbox.id})`,
    );
    return { outboxId: outbox.id, jobId: String(job.id) };
  }

  async sendSms(
    recipient: string,
    message: string,
    correlationId?: string,
  ): Promise<{ outboxId: string; jobId: string }> {
    // 1. Persist intent before enqueue (status = pending)
    const outbox = await this.prisma.notificationOutbox.create({
      data: {
        type: NotificationType.SMS,
        recipient,
        message,
        scheduledFor: new Date(),
      },
    });

    // 2. Enqueue the BullMQ job (carries outboxId and correlationId)
    const data: NotificationJobData = {
      type: NotificationType.SMS,
      recipient,
      message,
      timestamp: Date.now(),
      outboxId: outbox.id,
      correlationId,
    };

    const job = await this.notificationsQueue.add('send-sms', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    // 3. Update outbox record to enqueued with the BullMQ job ID
    await this.prisma.notificationOutbox.update({
      where: { id: outbox.id },
      data: {
        status: 'enqueued',
        jobId: String(job.id),
      },
    });

    this.logger.log(
      `Enqueued SMS job: ${job.id} for ${recipient} (outboxId: ${outbox.id})`,
    );
    return { outboxId: outbox.id, jobId: String(job.id) };
  }

  /**
   * Returns a single NotificationOutbox record by id, or null if not found.
   */
  async getOutboxRecord(id: string): Promise<NotificationOutbox | null> {
    return this.prisma.notificationOutbox.findUnique({ where: { id } });
  }

  /**
   * Returns all outbox records stuck in pending or enqueued status for more
   * than 10 minutes, ordered by scheduledFor ascending (oldest first).
   */
  async getStuckOutboxRecords(): Promise<NotificationOutbox[]> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    return this.prisma.notificationOutbox.findMany({
      where: {
        status: { in: ['pending', 'enqueued'] },
        scheduledFor: { lt: tenMinutesAgo },
      },
      orderBy: { scheduledFor: 'asc' },
    });
  }
}
