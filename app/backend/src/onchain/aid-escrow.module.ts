import { Module } from '@nestjs/common';
import { OnchainModule } from './onchain.module';
import { AidEscrowService } from './aid-escrow.service';
import { AidEscrowController } from './aid-escrow.controller';

@Module({
  imports: [OnchainModule],
  providers: [AidEscrowService],
  controllers: [AidEscrowController],
  exports: [AidEscrowService],
})
export class AidEscrowModule {}
