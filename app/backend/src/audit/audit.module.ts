import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditChainService } from './audit-chain.service';
import { MetricsModule } from './metrics.module';
import { AdminActionLogger } from './admin-action-logger.service';

@Global()
@Module({
  imports: [MetricsModule],
  providers: [AuditService, AuditChainService, AdminActionLogger],
  controllers: [AuditController],
  exports: [AuditService, AuditChainService, AdminActionLogger],
})
export class AuditModule {}
