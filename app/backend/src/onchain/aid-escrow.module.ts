import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OnchainModule } from './onchain.module';
import { AidEscrowService } from './aid-escrow.service';
import { AidEscrowController } from './aid-escrow.controller';
import { CommonServicesModule } from '../common/services/common-services.module';
import { BudgetService } from '../common/budget/budget.service';
import { SorobanEventCorrelationService } from './soroban-event-correlation.service';

@Module({
  imports: [OnchainModule, CommonServicesModule, ConfigModule],
  providers: [AidEscrowService, BudgetService],
  controllers: [AidEscrowController],
  exports: [AidEscrowService, SorobanEventCorrelationService],
})
export class AidEscrowModule {}
