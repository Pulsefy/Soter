import { Module } from '@nestjs/common';
import { getToken, PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { metricsProviders } from './metrics.providers';

@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
        config: {
          prefix: 'app_',
        },
      },
      path: '/metrics',
      defaultLabels: {
        app: 'nestjs-backend',
      },
    }),
  ],
  controllers: [MetricsController],
  providers: [MetricsService, ...metricsProviders],
  exports: [
    MetricsService,
    getToken('prisma_pool_size'),
    getToken('prisma_pool_connections_in_use'),
    getToken('prisma_pool_waiting_connections'),
    getToken('prisma_pool_wait_duration_seconds'),
  ],
})
export class MetricsModule {}
