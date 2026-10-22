import { Module } from '@interfaces/nestjs';
import { ConfigModule } from '@interfaces/config';
import { HttpModule } from '@interfaces/nestjs';

import { AdminCircuitBreakerController } from './admin-circuit-breaker.controller';
import { AdminCircuitBreakerService } from './admin-circuit-breaker.service';
import { CircuitBreakerService } from './circuit-breaker.service';

@Module({
  imports: [ConfigModule, HttpModule],
  controllers: [AdminCircuitBreakerController],
  providers: [CircuitBreakerService, AdminCircuitBreakerService],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule {}
