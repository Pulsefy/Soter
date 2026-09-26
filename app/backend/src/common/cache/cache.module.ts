import { Module, Global } from '@nestjs/common';
import { RedisService } from '../../../cache/redis.service';
import { CacheInvalidationService } from '../services/cache-invalidation.service';
import { CacheStatsController } from './cache-stats.controller';
import { MetricsModule } from '../../observability/metrics/metrics.module';

/**
 * Global cache module that provides RedisService and cache utilities
 * to all application modules without explicit imports.
 */
@Global()
@Module({
  imports: [MetricsModule],
  controllers: [CacheStatsController],
  providers: [RedisService, CacheInvalidationService],
  exports: [RedisService, CacheInvalidationService],
})
export class CacheModule {}
