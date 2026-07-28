import { Module, Global } from '@nestjs/common';
import { RedisService } from '../../../cache/redis.service';
import { CacheInvalidationService } from '../services/cache-invalidation.service';

/**
 * Global cache module that provides RedisService and cache utilities
 * to all application modules without explicit imports.
 */
@Global()
@Module({
  providers: [RedisService, CacheInvalidationService],
  exports: [RedisService, CacheInvalidationService],
})
export class CacheModule {}
