import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { DeploymentMetadataController } from './deployment-metadata.controller';
import { DeploymentMetadataService } from './deployment-metadata.service';
import { ContractConfigCacheService } from './contract-config-cache.service';
import { OnchainModule } from '../onchain/onchain.module';

@Module({
  imports: [PrismaModule, MetricsModule, OnchainModule],
  controllers: [DeploymentMetadataController],
  providers: [DeploymentMetadataService, ContractConfigCacheService],
  exports: [DeploymentMetadataService, ContractConfigCacheService],
})
export class DeploymentMetadataModule {}
