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
import { EnhancedVerificationFlowService } from './enhanced-verification-flow.service';
import { VerificationMetadataService } from './metadata.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { JobsModule } from '../jobs/jobs.module';
import { DeploymentMetadataModule } from '../deployment-metadata/deployment-metadata.module';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    PrismaModule,
    AuditModule,
    NotificationsModule,
    EncryptionModule,
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
    JobsModule,
    DeploymentMetadataModule, // Added for contract-aware metadata
  ],
  controllers: [VerificationController, VerificationInboxController],
  providers: [
    VerificationService,
    VerificationFlowService,
    VerificationProcessor,
    VerificationInboxService,
    EnhancedVerificationFlowService, // Added enhanced flow service
    VerificationMetadataService, // Added metadata service
  ],
  exports: [
    VerificationService,
    VerificationFlowService,
    VerificationInboxService,
    VerificationMetadataService, // Export for use in other modules
  ],
})
export class VerificationModule {}
