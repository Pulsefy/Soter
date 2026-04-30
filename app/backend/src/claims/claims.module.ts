import { Module } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { CancelAndReissueService } from './cancel-and-reissue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OnchainModule } from '../onchain/onchain.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { LoggerModule } from '../logger/logger.module';
import { AuditModule } from '../audit/audit.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { BudgetService } from '../common/budget/budget.service';
import { CommonServicesModule } from '../common/services/common-services.module';

@Module({
  imports: [
    PrismaModule,
    OnchainModule,
    MetricsModule,
    LoggerModule,
    AuditModule,
    EncryptionModule,
    CommonServicesModule,
  ],
  controllers: [ClaimsController],
  providers: [ClaimsService, CancelAndReissueService, BudgetService],
  exports: [CancelAndReissueService],
})
export class ClaimsModule {}
