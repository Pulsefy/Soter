import { Module } from '@nestjs/common';
import { AidService } from './aid.service';
import { AidController } from './aid.controller';
import { RedisService } from '../../cache/redis.service';
import { HmacModule } from '../common/hmac/hmac.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [HmacModule, MetricsModule, PrismaModule],
  providers: [AidService, RedisService],
  controllers: [AidController],
  exports: [AidService],
})
export class AidModule {}
