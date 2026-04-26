import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { HealthModule } from 'src/health/health.module';
import { MetricsMiddleware } from './metrics/metrics.middleware';
import { MetricsModule } from './metrics/metrics.module';
import { TracingService } from './tracing/tracing.service';

@Module({
  imports: [MetricsModule, HealthModule],
  providers: [TracingService],
  exports: [MetricsModule, HealthModule, TracingService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes('*'); // Apply to all routes
  }
}
