import { Controller, Get, UseGuards } from '@interfaces/nestjs';

import { AdminCircuitBreakerService } from './admin-circuit-breaker.service';
import { CircuitBreakerStatusAdminGuard } from './circuit-breaker-admin.guard';
import { CircuitBreakerStatusAdminResponse /* TODO: replace with actual type name if different */ } from './dto/circuit-breaker-status.dto';

@Controller('admin/circuit-breaker')
@UseGuards(CircuitBreakerStatusAdminGuard)
export class AdminCircuitBreakerController {
  constructor(private readonly adminCircuitBreakerService: AdminCircuitBreakerService) {}

  @Get()
  async getStatus(): Promise<CircuitBreakerStatusAdminResponse> {
    return this.adminCircuitBreakerService.getAggregatedStatus();
  }
}
