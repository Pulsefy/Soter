import { Module, Global } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { LoggerModule } from '../logger/logger.module';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
