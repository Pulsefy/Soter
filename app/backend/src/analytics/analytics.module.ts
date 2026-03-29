import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisService } from '../../cache/redis.service';

@Module({
  imports: [PrismaModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    /**
     * RedisService manages its own ioredis client and is provided here as a
     * plain class — no CacheModule or external adapter needed.
     * Connection is opened in onModuleInit and closed in onModuleDestroy.
     */
    RedisService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}