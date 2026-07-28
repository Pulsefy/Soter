import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { LoggerModule } from '../logger/logger.module';
import { MetricsModule } from '../observability/metrics/metrics.module';

@Global()
@Module({
  imports: [LoggerModule, MetricsModule],
import { MetricsModule } from './metrics.module';

@Global()
@Module({
  imports: [MetricsModule],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
