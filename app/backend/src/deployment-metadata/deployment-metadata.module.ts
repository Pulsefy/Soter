import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DeploymentMetadataController } from './deployment-metadata.controller';
import { DeploymentMetadataService } from './deployment-metadata.service';
import { ContractConfigCacheService } from './contract-config-cache.service';

@Module({
  imports: [PrismaModule],
  controllers: [DeploymentMetadataController],
  providers: [DeploymentMetadataService, ContractConfigCacheService],
  exports: [DeploymentMetadataService, ContractConfigCacheService],
})
export class DeploymentMetadataModule {}
