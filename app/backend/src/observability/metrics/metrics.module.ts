import { Module } from '@nestjs/common';
import { PrometheusModule, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
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
  providers: [
    MetricsService,
    ...metricsProviders,
    makeGaugeProvider({
      name: 'app_notification_outbox_dead_letter_depth',
      help: 'Current depth of the notification outbox dead-letter queue',
    }),
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
