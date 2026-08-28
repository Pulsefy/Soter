import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MetadataService } from './metadata.service';
import { ProviderHealthRegistryService } from './provider-health-registry.service';
import { LoggerModule } from '../logger/logger.module';
import { OnchainModule } from '../onchain/onchain.module';

@Module({
  imports: [LoggerModule, OnchainModule],
  controllers: [HealthController],
  providers: [HealthService, MetadataService, ProviderHealthRegistryService],
  exports: [ProviderHealthRegistryService],
})
export class HealthModule {}
