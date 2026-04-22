import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { OnchainModule } from '../onchain/onchain.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { LoggerModule } from '../logger/logger.module';
import { AuditModule } from '../audit/audit.module';
import { EncryptionModule } from '../common/encryption/encryption.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OnchainModule,
    MetricsModule,
    LoggerModule,
    AuditModule,
    EncryptionModule,
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
