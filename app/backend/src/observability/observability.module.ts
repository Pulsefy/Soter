import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { HealthModule } from 'src/health/health.module';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [MetricsModule, HealthModule],
  exports: [MetricsModule, HealthModule],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*'); // Apply to all routes
  }
}
