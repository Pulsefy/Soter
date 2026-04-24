import { Module } from '@nestjs/common';
import { AidService } from './aid.service';
import { AidController } from './aid.controller';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  providers: [AidService],
  controllers: [AidController],
  exports: [AidService],
})
export class AidModule {}
