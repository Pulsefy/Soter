import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditChainService } from './audit-chain.service';
import { MetricsModule } from './metrics.module';

@Global()
@Module({
  imports: [MetricsModule],
  providers: [AuditService, AuditChainService],
  controllers: [AuditController],
  exports: [AuditService, AuditChainService],
})
export class AuditModule {}
