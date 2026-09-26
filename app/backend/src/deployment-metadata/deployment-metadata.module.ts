import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OnchainModule } from '../onchain/onchain.module';
import { DeploymentMetadataController } from './deployment-metadata.controller';
import { DeploymentMetadataService } from './deployment-metadata.service';
import { ContractConfigCacheService } from './contract-config-cache.service';
import { ContractMigrationService } from './contract-migration.service';

@Module({
  imports: [PrismaModule, OnchainModule],
  controllers: [DeploymentMetadataController],
  providers: [
    DeploymentMetadataService,
    ContractConfigCacheService,
    ContractMigrationService,
  ],
  exports: [
    DeploymentMetadataService,
    ContractConfigCacheService,
    ContractMigrationService,
  ],
})
export class DeploymentMetadataModule {}
