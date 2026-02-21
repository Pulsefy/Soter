import { Module } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { OnchainModule } from '../onchain/onchain.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { LoggerModule } from '../logger/logger.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    OnchainModule,
    MetricsModule,
    LoggerModule,
    AuditModule,
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}
