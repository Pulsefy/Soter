import { Global, Module } from '@nestjs/common';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [MetricsModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
