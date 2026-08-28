import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionPolicyController } from './retention-policy.controller';
import {
  RetentionPurgeProcessor,
  RETENTION_PURGE_QUEUE,
} from './retention-purge.processor';
import { RetentionPurgeScheduler } from './retention-purge.scheduler';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    BullModule.registerQueue({ name: RETENTION_PURGE_QUEUE }),
  ],
  controllers: [RetentionPolicyController],
  providers: [
    RetentionPolicyService,
    RetentionPurgeProcessor,
    RetentionPurgeScheduler,
  ],
  exports: [RetentionPolicyService],
})
export class RetentionPolicyModule {}
