import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DeploymentMetadataController } from './deployment-metadata.controller';
import { DeploymentMetadataService } from './deployment-metadata.service';

@Module({
  imports: [PrismaModule],
  controllers: [DeploymentMetadataController],
  providers: [DeploymentMetadataService],
  exports: [DeploymentMetadataService],
})
export class DeploymentMetadataModule {}
