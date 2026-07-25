import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuditLog, NotificationOutbox } from '@prisma/client';
import {
  NotificationJobData,
  NotificationType,
} from './interfaces/notification-job.interface';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';

export interface ActivityFeedItem {
  id: string;
  type: 'notification' | 'audit' | 'review';
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  title: string;
  description: string;
  timestamp: Date;
  read: boolean;
  correlationId?: string;
  linkHref?: string;
  linkLabel?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly loggerService: LoggerService,
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
    const propagatedCorrelationId =
      correlationId ?? this.loggerService.getCorrelationId();

    const data: NotificationJobData = {
      type: NotificationType.EMAIL,
      recipient,
      subject,
      message,
      timestamp: Date.now(),
      outboxId: outbox.id,
      correlationId: propagatedCorrelationId,
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

    const correlationSuffix = propagatedCorrelationId
      ? ` [correlationId=${propagatedCorrelationId}]`
      : '';
    this.logger.log(
      `Enqueued email job: ${job.id} for ${recipient} (outboxId: ${outbox.id})${correlationSuffix}`,
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
    const propagatedCorrelationId =
      correlationId ?? this.loggerService.getCorrelationId();

    const data: NotificationJobData = {
      type: NotificationType.SMS,
      recipient,
      message,
      timestamp: Date.now(),
      outboxId: outbox.id,
      correlationId: propagatedCorrelationId,
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

    const correlationSuffix = propagatedCorrelationId
      ? ` [correlationId=${propagatedCorrelationId}]`
      : '';
    this.logger.log(
      `Enqueued SMS job: ${job.id} for ${recipient} (outboxId: ${outbox.id})${correlationSuffix}`,
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

  async getActivityFeed(limit = 30): Promise<ActivityFeedItem[]> {
    const take = Math.min(Math.max(limit, 1), 100);
    const [notifications, auditLogs, reviews] = await this.prisma.$transaction([
      this.prisma.notificationOutbox.findMany({
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.auditLog.findMany({
        where: { deletedAt: null },
        orderBy: { timestamp: 'desc' },
        take,
      }),
      this.prisma.verificationRequest.findMany({
        where: { deletedAt: null },
        orderBy: [{ reviewedAt: 'desc' }, { updatedAt: 'desc' }],
        take,
      }),
    ]);

    return [
      ...notifications.map(record => this.mapOutboxToFeedItem(record)),
      ...auditLogs.map(record => this.mapAuditToFeedItem(record)),
      ...reviews.map(record => ({
        id: `review:${record.id}`,
        type: 'review' as const,
        status:
          record.status === 'rejected'
            ? ('failed' as const)
            : record.status === 'approved'
              ? ('succeeded' as const)
              : ('pending' as const),
        title: `Verification ${record.status.replaceAll('_', ' ')}`,
        description: record.nextStepMessage
          ? record.nextStepMessage
          : record.reviewedBy
            ? `Reviewed by ${record.reviewedBy}`
            : 'Awaiting reviewer action',
        timestamp: record.reviewedAt ?? record.updatedAt ?? record.createdAt,
        read: record.status === 'approved' || record.status === 'rejected',
        linkHref: `/verification-review?requestId=${record.id}`,
        linkLabel: 'Open review',
        metadata: { requestId: record.id, orgId: record.orgId },
      })),
    ]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, take);
  }

  private mapOutboxToFeedItem(record: NotificationOutbox): ActivityFeedItem {
    const metadata = this.parseMetadata(record.metadata);
    const correlationId =
      typeof metadata.correlationId === 'string'
        ? metadata.correlationId
        : (record.jobId ?? undefined);

    return {
      id: `notification:${record.id}`,
      type: 'notification',
      status:
        record.status === 'failed'
          ? 'failed'
          : record.status === 'sent'
            ? 'succeeded'
            : record.status === 'enqueued'
              ? 'processing'
              : 'pending',
      title: record.subject ?? `${record.type.toUpperCase()} notification`,
      description: record.lastError ?? record.message,
      timestamp: record.sentAt ?? record.lastAttemptAt ?? record.createdAt,
      read: record.status === 'sent',
      correlationId,
      linkHref: `/notifications/outbox/${record.id}`,
      linkLabel: 'Open outbox record',
      metadata: {
        ...metadata,
        outboxId: record.id,
        recipient: record.recipient,
      },
    };
  }

  private mapAuditToFeedItem(record: AuditLog): ActivityFeedItem {
    const metadata =
      record.metadata && typeof record.metadata === 'object'
        ? (record.metadata as Record<string, unknown>)
        : {};
    const correlationId =
      typeof metadata.correlationId === 'string'
        ? metadata.correlationId
        : undefined;

    return {
      id: `audit:${record.id}`,
      type: 'audit',
      status: 'succeeded',
      title: `${record.action} ${record.entity}`,
      description: `Actor ${record.actorId} updated ${record.entityId}`,
      timestamp: record.timestamp,
      read: true,
      correlationId,
      linkHref: `/${record.entity.toLowerCase()}s/${record.entityId}`,
      linkLabel: 'Open record',
      metadata,
    };
  }

  private parseMetadata(metadata: string | null): Record<string, unknown> {
    if (!metadata) return {};
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
