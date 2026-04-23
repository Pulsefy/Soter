import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationProcessor } from './notifications.processor';
import { JobsModule } from '../jobs/jobs.module';

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
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            count: 100,  // keep last 100 completed notification jobs
            age: 86400,  // and no older than 24 h
          },
          removeOnFail: false, // keep all failed jobs for audit / DLQ inspection
        },
      }),
      inject: [ConfigService],
    }),
    // Import JobsModule to get access to DeadLetterService
    JobsModule,
  ],
  providers: [NotificationsService, NotificationProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
