import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VerificationFlowService } from './verification-flow.service';
import { VerificationProcessor } from './verification.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    PrismaModule,
    AuditModule,
    NotificationsModule,
    WebhooksModule,
    BullModule.registerQueueAsync({
      name: 'verification',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [VerificationController],
  providers: [
    VerificationService,
    VerificationFlowService,
    VerificationProcessor,
  ],
  exports: [VerificationService, VerificationFlowService],
})
export class VerificationModule {}
