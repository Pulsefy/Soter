import { Module } from '@nestjs/common';
import { OnchainModule } from './onchain.module';
import { AidEscrowService } from './aid-escrow.service';
import { AidEscrowController } from './aid-escrow.controller';
import { CommonServicesModule } from '../common/services/common-services.module';
import { BudgetService } from '../common/budget/budget.service';

@Module({
  imports: [OnchainModule, CommonServicesModule],
  providers: [AidEscrowService, BudgetService],
  controllers: [AidEscrowController],
  exports: [AidEscrowService],
})
export class AidEscrowModule {}
