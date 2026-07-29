import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DeploymentMetadataController } from './deployment-metadata.controller';
import { DeploymentMetadataService } from './deployment-metadata.service';
import { ContractConfigCacheService } from './contract-config-cache.service';
import { ContractRegistrySyncService } from './contract-registry-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [DeploymentMetadataController],
  providers: [
    DeploymentMetadataService,
    ContractConfigCacheService,
    ContractRegistrySyncService,
  ],
  exports: [
    DeploymentMetadataService,
    ContractConfigCacheService,
    ContractRegistrySyncService,
  ],
})
export class DeploymentMetadataModule {}
