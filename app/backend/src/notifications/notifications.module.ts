import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationProcessor } from './notifications.processor';
import { NotificationBackpressureService } from './notification-backpressure.service';
import { NotificationQueueMetricsScheduler } from './notification-queue-metrics.scheduler';
import { NotificationCanaryScheduler } from './notification-canary.scheduler';
import { NotificationProviderHealthService } from './notification-provider-health.service';
import { OutboxController } from './outbox.controller';
import { NotificationsController } from './notifications.controller';
import { JobsModule } from '../jobs/jobs.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { LoggerModule } from '../logger/logger.module';
import {
  DeliveryAdapter,
  EMAIL_ADAPTER,
  SMS_ADAPTER,
} from './adapters/delivery-adapter.interface';
import { ConsoleEmailAdapter } from './adapters/console-email.adapter';
import { ConsoleSmsAdapter } from './adapters/console-sms.adapter';
import { SendGridEmailAdapter } from './adapters/sendgrid-email.adapter';
import { TwilioSmsAdapter } from './adapters/twilio-sms.adapter';

const skipBackgroundJobs = process.env.SKIP_BACKGROUND_JOBS === 'true';

function createEmailAdapter(config: ConfigService): DeliveryAdapter {
  const apiKey = config.get<string>('SENDGRID_API_KEY');
  const fromEmail = config.get<string>('SENDGRID_FROM_EMAIL');
  if (apiKey && fromEmail) {
    return new SendGridEmailAdapter(config);
  }
  return new ConsoleEmailAdapter();
}

function createSmsAdapter(config: ConfigService): DeliveryAdapter {
  const accountSid = config.get<string>('TWILIO_ACCOUNT_SID');
  const authToken = config.get<string>('TWILIO_AUTH_TOKEN');
  const fromNumber = config.get<string>('TWILIO_FROM_NUMBER');
  if (accountSid && authToken && fromNumber) {
    return new TwilioSmsAdapter(config);
  }
  return new ConsoleSmsAdapter();
}

@Module({
  imports: [
    ConfigModule,
    ...(skipBackgroundJobs
      ? []
      : [
          BullModule.registerQueueAsync({
            name: 'notifications',
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
              connection: {
                host: configService.get<string>('REDIS_HOST') || 'localhost',
                port: parseInt(
                  configService.get<string>('REDIS_PORT') || '6379',
                ),
              },
            }),
            inject: [ConfigService],
          }),
        ]),
    JobsModule,
    MetricsModule,
    LoggerModule,
  ],
  controllers: [OutboxController, NotificationsController],
  providers: [
    NotificationsService,
    NotificationProcessor,
    NotificationBackpressureService,
    NotificationQueueMetricsScheduler,
    NotificationCanaryScheduler,
    NotificationProviderHealthService,
    {
      provide: EMAIL_ADAPTER,
      useFactory: createEmailAdapter,
      inject: [ConfigService],
    },
    {
      provide: SMS_ADAPTER,
      useFactory: createSmsAdapter,
      inject: [ConfigService],
    },
  ],
  exports: [NotificationsService, NotificationProviderHealthService],
})
export class NotificationsModule {}
