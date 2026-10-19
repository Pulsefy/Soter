import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MetadataService } from './metadata.service';
import { ProviderHealthRegistryService } from './provider-health-registry.service';
import { HealthRateLimitInterceptor } from './health-rate-limit.interceptor';
import { LoggerModule } from '../logger/logger.module';
import { OnchainModule } from '../onchain/onchain.module';
import { RedisModule } from '../redis/redis.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [LoggerModule, OnchainModule, RedisModule, NotificationsModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    MetadataService,
    ProviderHealthRegistryService,
    HealthRateLimitInterceptor,
  ],
  exports: [ProviderHealthRegistryService],
})
export class HealthModule {}
