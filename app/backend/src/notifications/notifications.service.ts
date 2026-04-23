import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  NotificationJobData,
  NotificationType,
} from './interfaces/notification-job.interface';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  async sendEmail(recipient: string, subject: string, message: string) {
    const data: NotificationJobData = {
      type: NotificationType.EMAIL,
      recipient,
      subject,
      message,
      timestamp: Date.now(),
    };

    const job = await this.notificationsQueue.add('send-email', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    this.logger.log(`Enqueued email job: ${job.id} for ${recipient}`);
    return job;
  }

  async sendSms(recipient: string, message: string) {
    const data: NotificationJobData = {
      type: NotificationType.SMS,
      recipient,
      message,
      timestamp: Date.now(),
    };

    const job = await this.notificationsQueue.add('send-sms', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    this.logger.log(`Enqueued SMS job: ${job.id} for ${recipient}`);
    return job;
  }
}
