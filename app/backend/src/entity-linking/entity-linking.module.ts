import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EntityLinkingService } from './entity-linking.service';
import { EntityLinkingController } from './entity-linking.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MetricsModule } from '../observability/metrics/metrics.module';

@Module({
  imports: [PrismaModule, ConfigModule, MetricsModule],
  controllers: [EntityLinkingController],
  providers: [EntityLinkingService],
  exports: [EntityLinkingService],
})
export class EntityLinkingModule {}
