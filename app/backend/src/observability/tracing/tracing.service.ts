import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class TracingService {
  private readonly logger = new Logger(TracingService.name);

  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Trace an external call with automatic metrics and logging
   */
  async traceExternalCall<T>(
    operation: string,
    service: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const startTime = Date.now();

    this.logger.log(`Starting external call: ${operation}`, 'TracingService', {
      operation,
      service,
      ...metadata,
    });

    try {
      const result = await fn();
      const duration = (Date.now() - startTime) / 1000; // Convert to seconds

      this.logger.log(
        `External call completed: ${operation}`,
        'TracingService',
        {
          operation,
          service,
          duration_ms: duration * 1000,
          status: 'success',
        },
      );

      // Record metrics based on service type
      if (service === 'horizon' || service === 'soroban') {
        this.metricsService.recordOnchainDuration(operation, service, duration);
        this.metricsService.incrementOnchainOperation(
          operation,
          service,
          'success',
        );
      } else if (service === 'email' || service === 'push') {
        this.metricsService.recordWebhookDeliveryDuration(service, duration);
      }

      return result;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;

      this.logger.error(
        `External call failed: ${operation}`,
        (error as Error).stack,
        'TracingService',
        {
          operation,
          service,
          duration_ms: duration * 1000,
          status: 'error',
          error: (error as Error).message,
        },
      );

      // Record error metrics
      if (service === 'horizon' || service === 'soroban') {
        this.metricsService.recordOnchainDuration(operation, service, duration);
        this.metricsService.incrementOnchainOperation(
          operation,
          service,
          'failed',
        );
      }

      throw error;
    }
  }
}
