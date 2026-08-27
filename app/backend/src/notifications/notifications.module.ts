import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationProcessor } from './notifications.processor';
import { OutboxController } from './outbox.controller';
import { NotificationsController } from './notifications.controller';
import { JobsModule } from '../jobs/jobs.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { LoggerModule } from '../logger/logger.module';
import { DeliveryAdapterFactory } from './adapters/delivery-adapter.factory';
import { MockDeliveryAdapter } from './adapters/mock-delivery.adapter';
import { SendGridEmailAdapter } from './adapters/sendgrid-email.adapter';
import { TwilioSmsAdapter } from './adapters/twilio-sms.adapter';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueueAsync({
      name: 'notifications',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
      }),
      inject: [ConfigService],
    }),
    JobsModule,
    MetricsModule,
    LoggerModule,
  ],
  controllers: [OutboxController, NotificationsController],
  providers: [
    NotificationsService,
    NotificationProcessor,
    DeliveryAdapterFactory,
    MockDeliveryAdapter,
    SendGridEmailAdapter,
    TwilioSmsAdapter,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
