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
import { VerificationInboxSseController } from './verification-inbox-sse.controller';
import { VerificationInboxEventsService } from './verification-inbox-events.service';
import { EnhancedVerificationFlowService } from './enhanced-verification-flow.service';
import { VerificationMetadataService } from './metadata.service';
import { ReviewLockService } from './review-lock.service';
import { ReviewLockScheduler } from './review-lock.scheduler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { JobsModule } from '../jobs/jobs.module';
import { DeploymentMetadataModule } from '../deployment-metadata/deployment-metadata.module';
import { MetricsModule } from '../observability/metrics/metrics.module';

const skipBackgroundJobs = process.env.SKIP_BACKGROUND_JOBS === 'true';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    PrismaModule,
    AuditModule,
    NotificationsModule,
    EncryptionModule,
    ...(skipBackgroundJobs
      ? []
      : [
          BullModule.registerQueueAsync({
            name: 'verification',
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
    DeploymentMetadataModule, // Added for contract-aware metadata
    MetricsModule, // Added for verification priority metrics
  ],
  controllers: [
    VerificationController,
    VerificationInboxController,
    VerificationInboxSseController, // Added inbox SSE stream endpoint
  ],
  providers: [
    VerificationService,
    VerificationFlowService,
    VerificationProcessor,
    VerificationInboxService,
    VerificationInboxEventsService, // Added inbox event fan-out hub
    EnhancedVerificationFlowService, // Added enhanced flow service
    VerificationMetadataService, // Added metadata service
    ReviewLockService, // Added review lock service
    ReviewLockScheduler, // Added stale-lock recovery scheduler
  ],
  exports: [
    VerificationService,
    VerificationFlowService,
    VerificationInboxService,
    VerificationInboxEventsService, // Export so other producers can publish
    VerificationMetadataService, // Export for use in other modules
    ReviewLockService, // Export for use in other modules
  ],
})
export class VerificationModule {}
