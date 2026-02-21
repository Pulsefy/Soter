import { Controller } from '@nestjs/common';

/**
 * MetricsController
 *
 * Note: The /metrics endpoint is automatically registered by PrometheusModule.
 * This controller is kept for potential custom metrics endpoints in the future.
 */
@Controller()
export class MetricsController {
  // Metrics endpoint is handled by PrometheusModule
  // Custom metrics endpoints can be added here if needed
}
