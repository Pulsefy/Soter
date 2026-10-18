import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DriftReportController } from './drift-report.controller';
import { DriftReportService } from './drift-report.service';
import { DeploymentMetadataModule } from '../deployment-metadata/deployment-metadata.module';
import { OnchainModule } from '../onchain/onchain.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    DeploymentMetadataModule,
    OnchainModule,
  ],
  controllers: [DriftReportController],
  providers: [DriftReportService],
  exports: [DriftReportService],
})
export class DriftReportModule {}
