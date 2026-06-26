import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VerificationFlowService } from './verification-flow.service';
import { VerificationProcessor } from './verification.processor';
import { VerificationInboxController } from './verification-inbox.controller';
import { VerificationInboxService } from './verification-inbox.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { JobsModule } from '../jobs/jobs.module';
import { HmacModule } from '../common/hmac/hmac.module';
import { WebhookService } from './webhook.service';
import { WebhookProcessor } from './webhook.processor';
import { MetricsModule } from '../observability/metrics/metrics.module';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    PrismaModule,
    AuditModule,
    NotificationsModule,
    EncryptionModule,
    HmacModule,
    MetricsModule,
    BullModule.registerQueueAsync({
      name: 'verification',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: 'webhooks',
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
  ],
  controllers: [VerificationController, VerificationInboxController],
  providers: [
    VerificationService,
    VerificationFlowService,
    VerificationProcessor,
    VerificationInboxService,
    WebhookService,
    WebhookProcessor,
  ],
  exports: [
    VerificationService,
    VerificationFlowService,
    VerificationInboxService,
    WebhookService,
  ],
})
export class VerificationModule {}
